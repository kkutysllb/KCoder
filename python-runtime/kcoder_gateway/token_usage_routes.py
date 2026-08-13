"""Token usage statistics endpoints — 跨会话聚合的用量统计.

数据流::

    renderer Settings > Token 统计与预算 > Dashboard
        ↓ getTokenUsageStats / getTokenUsageTimeseries
    GET /v1/token-usage/stats
    GET /v1/token-usage/timeseries
        ↓ 聚合查询 runs 表（RunRow）
    QiLin RunJournal（run 完成时写入 total_tokens 等字段）

设计要点：
    1. 数据源是 QiLin 的 ``RunRow``（runs 表）——由引擎 RunJournal 在
       run 完成时累积写入（vendor/qilin/runtime/journal.py），与 KWorks
       的 token-usage 统计同源同构。
    2. 月份窗口按北京时间（UTC+8）计算边界，与前端展示约定一致。
    3. ``by_model`` 的桶来自 ``token_usage_by_model``（provider 上报的
       模型名）；旧行回退到 ``model_name``。
    4. 需要 SQL 后端（sqlite/postgres）；未初始化时返回 503，与
       KWorks console 的 _session_factory_or_503 行为一致。
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, time, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select

logger = logging.getLogger("kcoder_gateway.token_usage")

router = APIRouter(prefix="/v1/token-usage", tags=["token-usage"])

# 北京时区偏移（与 KWorks 前端展示约定一致）
_TZ_DELTA = timedelta(hours=8)


# ────────────────────────────────────────────────────────────────
# 响应模型
# ────────────────────────────────────────────────────────────────


class ModelBreakdown(BaseModel):
    """单模型的 token 用量分解。"""

    tokens: int = 0
    runs: int = 0
    llm_call_count: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = Field(default=0, description="Prompt 缓存命中的输入 token")


class CallerBreakdown(BaseModel):
    """按调用方（lead agent / subagent / middleware）分解。"""

    lead_agent: int = 0
    subagent: int = 0
    middleware: int = 0


class TokenUsageStatsResponse(BaseModel):
    """跨全部会话的全局 token 用量统计。"""

    total_tokens: int = 0
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    total_runs: int = 0
    total_llm_call_count: int = 0
    total_cache_read_tokens: int = Field(default=0, description="聚合的 Prompt 缓存命中输入 token")
    by_model: dict[str, ModelBreakdown] = Field(default_factory=dict)
    by_caller: CallerBreakdown = Field(default_factory=CallerBreakdown)


class TimeseriesItem(BaseModel):
    """某天某模型的一日用量。"""

    date: str
    model_name: str
    run_count: int = 0
    llm_call_count: int = 0
    total_tokens: int = 0
    input_tokens: int = 0
    output_tokens: int = 0


# ────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────


def _session_factory_or_503():
    """获取 SQLAlchemy async session factory；未初始化 DB 时返回 503。"""
    try:
        from qilin.persistence.engine import get_session_factory

        sf = get_session_factory()
    except Exception:
        logger.exception("Failed to resolve session factory")
        sf = None
    if sf is None:
        raise HTTPException(
            status_code=503,
            detail="Token usage requires a SQL database backend; set database.backend to sqlite or postgres in config.yaml.",
        )
    return sf


def _resolve_user_id(request: Request) -> str | None:
    """解析当前用户；未认证（开发模式）时返回 None（查询全部）。"""
    resolved = getattr(request.state, "user_id", None)
    if isinstance(resolved, str) and resolved:
        return resolved
    return None


def _month_window(year: int | None, month: int | None) -> tuple[datetime, datetime]:
    """计算查询窗口（UTC）。给定 year/month 时按北京时区的自然月；否则当月。"""
    if year and month:
        start_local = datetime(year, month, 1).date()
        if month == 12:
            end_local = datetime(year + 1, 1, 1).date()
        else:
            end_local = datetime(year, month + 1, 1).date()
    else:
        today_local = (datetime.now(UTC) + _TZ_DELTA).date()
        start_local = today_local.replace(day=1)
        if today_local.month == 12:
            end_local = today_local.replace(year=today_local.year + 1, month=1, day=1)
        else:
            end_local = today_local.replace(month=today_local.month + 1, day=1)
    return (
        datetime.combine(start_local, time.min, tzinfo=UTC) - _TZ_DELTA,
        datetime.combine(end_local, time.min, tzinfo=UTC) - _TZ_DELTA,
    )


def _local_date(created: datetime | None) -> str | None:
    """把 DB 时间戳归一化为北京时间日期（SQLite 存 naive，Postgres 存 aware）。"""
    if created is None:
        return None
    if created.tzinfo is None:
        created = created.replace(tzinfo=UTC)
    return ((created + _TZ_DELTA).date()).isoformat()


def _usage_map(row: Any) -> dict[str, Any]:
    """读取行的 token_usage_by_model（防御非 dict 脏数据）。"""
    raw = getattr(row, "token_usage_by_model", None)
    return raw if isinstance(raw, dict) else {}


def _model_count(usage_map: dict[str, Any]) -> int:
    return len([m for m in usage_map if isinstance(usage_map[m], dict)])


# ────────────────────────────────────────────────────────────────
# run 用量持久化（sse.py 消费流结束时调用）
# ────────────────────────────────────────────────────────────────


async def persist_run_usage(
    *,
    run_id: str,
    thread_id: str,
    assistant_id: str | None,
    user_id: str | None,
    status: str,
    usage_by_model: dict[str, dict[str, int]],
    llm_call_count: int,
    model_name: str | None = None,
    error: str | None = None,
) -> bool:
    """run 结束后将用量写入 runs 表（RunRow），供统计 API 聚合。

    KCoder 对话走 LangGraph Platform 的 ``/runs/stream``（langgraph dev），
    不经过引擎的 RunJournal（仅在引擎 runs worker 路径实例化），因此由
    gateway 在 SSE 消费循环的收尾阶段补写一行，与引擎 RunJournal 同构
    （同表、同字段、同 token_usage_by_model 桶结构）。

    Returns:
        True 写入成功；False run_id 已存在（幂等，不覆盖）。
    """
    sf = _session_factory_or_503()
    total_input = sum(m.get("input_tokens", 0) or 0 for m in usage_by_model.values())
    total_output = sum(m.get("output_tokens", 0) or 0 for m in usage_by_model.values())
    total = sum(m.get("total_tokens", 0) or 0 for m in usage_by_model.values())

    from qilin.persistence.run.model import RunRow

    async with sf() as session:
        existing = await session.get(RunRow, run_id)
        if existing is not None:
            return False
        session.add(
            RunRow(
                run_id=run_id,
                thread_id=thread_id,
                assistant_id=assistant_id,
                user_id=user_id,
                status=status,
                operation_kind="run",
                model_name=model_name,
                error=error,
                total_input_tokens=total_input,
                total_output_tokens=total_output,
                total_tokens=total,
                llm_call_count=llm_call_count,
                token_usage_by_model={
                    model: {
                        "total_tokens": int(b.get("total_tokens") or 0),
                        "input_tokens": int(b.get("input_tokens") or 0),
                        "output_tokens": int(b.get("output_tokens") or 0),
                        "cache_read_tokens": int(b.get("cache_read_tokens") or 0),
                    }
                    for model, b in usage_by_model.items()
                },
            )
        )
        await session.commit()
    return True


# ────────────────────────────────────────────────────────────────
# 端点
# ────────────────────────────────────────────────────────────────


@router.get("/stats", response_model=TokenUsageStatsResponse)
async def token_usage_stats(
    request: Request,
    year: int | None = Query(default=None, ge=2020, le=2100),
    month: int | None = Query(default=None, ge=1, le=12),
) -> TokenUsageStatsResponse:
    """跨全部会话聚合 token 用量；可按自然月（北京时间）过滤。"""
    sf = _session_factory_or_503()
    user_id = _resolve_user_id(request)
    window_start, window_end = _month_window(year, month)

    from qilin.persistence.run.model import RunRow

    stmt = select(RunRow).where(
        RunRow.operation_kind == "run",
        RunRow.created_at >= window_start,
        RunRow.created_at < window_end,
    )
    if user_id:
        stmt = stmt.where(RunRow.user_id == user_id)

    async with sf() as session:
        rows = (await session.execute(stmt)).scalars().all()

    total_tokens = total_input = total_output = total_runs = total_llm = total_cache = 0
    lead_agent = subagent = middleware = 0
    by_model: dict[str, dict[str, int]] = {}

    for row in rows:
        total_runs += 1
        total_tokens += row.total_tokens or 0
        total_input += row.total_input_tokens or 0
        total_output += row.total_output_tokens or 0
        total_llm += row.llm_call_count or 0
        lead_agent += row.lead_agent_tokens or 0
        subagent += row.subagent_tokens or 0
        middleware += row.middleware_tokens or 0

        usage_map = _usage_map(row)
        if usage_map:
            for model, usage in usage_map.items():
                if not isinstance(usage, dict):
                    continue
                entry = by_model.setdefault(model, {
                    "tokens": 0, "runs": 0, "llm_call_count": 0,
                    "input_tokens": 0, "output_tokens": 0, "cache_read_tokens": 0,
                })
                entry["tokens"] += int(usage.get("total_tokens") or 0)
                entry["runs"] += 1
                entry["input_tokens"] += int(usage.get("input_tokens") or 0)
                entry["output_tokens"] += int(usage.get("output_tokens") or 0)
                cache_read = int(usage.get("cache_read_tokens") or 0)
                entry["cache_read_tokens"] += cache_read
                total_cache += cache_read
        elif row.model_name and (row.total_tokens or 0) > 0:
            entry = by_model.setdefault(row.model_name, {
                "tokens": 0, "runs": 0, "llm_call_count": 0,
                "input_tokens": 0, "output_tokens": 0, "cache_read_tokens": 0,
            })
            entry["tokens"] += row.total_tokens or 0
            entry["runs"] += 1
            entry["input_tokens"] += row.total_input_tokens or 0
            entry["output_tokens"] += row.total_output_tokens or 0

        # llm_call_count 按模型数均摊到 by_model（单模型时即全量）
        if usage_map:
            count = _model_count(usage_map)
            if count > 0:
                per_model_llm = (row.llm_call_count or 0) // count
                for model in usage_map:
                    if isinstance(usage_map[model], dict):
                        by_model[model]["llm_call_count"] += per_model_llm

    return TokenUsageStatsResponse(
        total_tokens=total_tokens,
        total_input_tokens=total_input,
        total_output_tokens=total_output,
        total_runs=total_runs,
        total_llm_call_count=total_llm,
        total_cache_read_tokens=total_cache,
        by_model={k: ModelBreakdown(**v) for k, v in by_model.items()},
        by_caller=CallerBreakdown(
            lead_agent=lead_agent,
            subagent=subagent,
            middleware=middleware,
        ),
    )


@router.get("/timeseries", response_model=list[TimeseriesItem])
async def token_usage_timeseries(
    request: Request,
    days: int = Query(default=30, ge=1, le=365),
    year: int | None = Query(default=None, ge=2020, le=2100),
    month: int | None = Query(default=None, ge=1, le=12),
) -> list[TimeseriesItem]:
    """按天×模型返回 token 用量时间序列。

    给定 year/month 时窗口为该自然月（北京时间）；否则为最近 ``days`` 天。
    """
    sf = _session_factory_or_503()
    user_id = _resolve_user_id(request)

    if year and month:
        window_start, window_end = _month_window(year, month)
    else:
        today_local = (datetime.now(UTC) + _TZ_DELTA).date()
        window_start = datetime.combine(
            today_local - timedelta(days=days - 1), time.min, tzinfo=UTC
        ) - _TZ_DELTA
        window_end = datetime.combine(today_local + timedelta(days=1), time.min, tzinfo=UTC) - _TZ_DELTA

    from qilin.persistence.run.model import RunRow

    stmt = select(RunRow).where(
        RunRow.operation_kind == "run",
        RunRow.created_at >= window_start,
        RunRow.created_at < window_end,
    )
    if user_id:
        stmt = stmt.where(RunRow.user_id == user_id)

    async with sf() as session:
        rows = (await session.execute(stmt)).scalars().all()

    # Bucket by (date, model)
    buckets: dict[tuple[str, str], dict[str, int]] = {}
    for row in rows:
        date_str = _local_date(row.created_at)
        if date_str is None:
            continue
        usage_map = _usage_map(row)
        if usage_map:
            count = _model_count(usage_map)
            for model, usage in usage_map.items():
                if not isinstance(usage, dict):
                    continue
                key = (date_str, model)
                b = buckets.setdefault(key, {
                    "run_count": 0, "llm_call_count": 0,
                    "total_tokens": 0, "input_tokens": 0, "output_tokens": 0,
                })
                b["run_count"] += 1
                b["total_tokens"] += int(usage.get("total_tokens") or 0)
                b["input_tokens"] += int(usage.get("input_tokens") or 0)
                b["output_tokens"] += int(usage.get("output_tokens") or 0)
                if count > 0:
                    b["llm_call_count"] += (row.llm_call_count or 0) // count
        elif row.model_name:
            key = (date_str, row.model_name)
            b = buckets.setdefault(key, {
                "run_count": 0, "llm_call_count": 0,
                "total_tokens": 0, "input_tokens": 0, "output_tokens": 0,
            })
            b["run_count"] += 1
            b["total_tokens"] += row.total_tokens or 0
            b["input_tokens"] += row.total_input_tokens or 0
            b["output_tokens"] += row.total_output_tokens or 0
            b["llm_call_count"] += row.llm_call_count or 0

    return [
        TimeseriesItem(date=d, model_name=m, **vals)
        for (d, m), vals in sorted(buckets.items())
    ]
