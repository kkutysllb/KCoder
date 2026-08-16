"""KCoder 产品级本地服务 CLI（2026-08 重构后）。

自研 kcoder_gateway 删除后，以下产品功能由主进程经本 CLI 提供
（Electron 主进程无 yaml/sqlite 依赖，统一复用 python-runtime venv）：

  runtime-config get [section]        读取 qilin.runtime.yaml（全部或单段）
  runtime-config set <section> <json> 写回单段（yaml 安全合并）
  token-usage stats [year] [month]    聚合 runs 表用量（月度窗口，北京时间）
  token-usage timeseries <days>       按天×模型用量序列

数据路径：
- runtime config: <KCODER_APP_DATA_DIR>/config/qilin.runtime.yaml
- runs 表:       <KCODER_APP_DATA_DIR>/runtime/qilin/data/qilin.db
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

TZ_DELTA = timedelta(hours=8)


def _data_root() -> Path:
    env = os.environ.get("KCODER_APP_DATA_DIR")
    return Path(env) if env else Path.home() / ".kcoder"


def _runtime_config_path() -> Path:
    return _data_root() / "config" / "qilin.runtime.yaml"


def _load_yaml() -> dict:
    import yaml
    p = _runtime_config_path()
    if not p.exists():
        return {}
    return yaml.safe_load(p.read_text(encoding="utf-8")) or {}


def _save_yaml(cfg: dict) -> None:
    import yaml
    p = _runtime_config_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(yaml.safe_dump(cfg, allow_unicode=True, sort_keys=False), encoding="utf-8")


def cmd_runtime_config_get(args: list[str]) -> None:
    cfg = _load_yaml()
    section = args[0] if args else None
    if section:
        _emit(cfg.get(section))
    else:
        _emit(cfg)


def cmd_runtime_config_set(args: list[str]) -> None:
    section, raw = args[0], args[1]
    value = json.loads(raw)
    cfg = _load_yaml()
    cfg[section] = value
    _save_yaml(cfg)
    _emit({"ok": True, "section": section})


# ── token usage（runs 表聚合，语义与旧 token_usage_routes.py 对齐）──

def _run_rows(db: Path, *, month_start: datetime | None = None,
              month_end: datetime | None = None, days: int | None = None) -> list[tuple]:
    if not db.exists():
        return []
    # immutable=1：只读快照模式，跳过 WAL/锁检查（沙箱与并发安全）
    con = sqlite3.connect(f"file:{db}?mode=ro&immutable=1", uri=True)
    try:
        where = []
        params: list = []
        if month_start is not None and month_end is not None:
            where.append("created_at >= ? AND created_at < ?")
            params += [month_start.isoformat(), month_end.isoformat()]
        if days is not None:
            since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
            where.append("created_at >= ?")
            params.append(since)
        sql = ("SELECT run_id, created_at, model_name, total_input_tokens, "
               "total_output_tokens, total_tokens, llm_call_count, status "
               "FROM runs")
        if where:
            sql += " WHERE " + " AND ".join(where)
        rows = con.execute(sql, params).fetchall()
    finally:
        con.close()
    return rows


def _month_window(year: int | None, month: int | None) -> tuple[datetime, datetime]:
    if year and month:
        start_local = datetime(year, month, 1)
        if month == 12:
            end_local = datetime(year + 1, 1, 1)
        else:
            end_local = datetime(year, month + 1, 1)
    else:
        today = datetime.now(timezone.utc) + TZ_DELTA
        start_local = today.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        end_local = (start_local + timedelta(days=32)).replace(day=1)
    return (start_local - TZ_DELTA, end_local - TZ_DELTA)


def cmd_token_usage_stats(args: list[str]) -> None:
    year = int(args[0]) if len(args) > 0 and args[0] else None
    month = int(args[1]) if len(args) > 1 and args[1] else None
    start, end = _month_window(year, month)
    db = _data_root() / "runtime" / "qilin" / "data" / "qilin.db"
    rows = _run_rows(db, month_start=start, month_end=end)
    total_input = sum(r[3] or 0 for r in rows)
    total_output = sum(r[4] or 0 for r in rows)
    total = sum(r[5] or 0 for r in rows)
    runs = len(rows)
    llm_calls = sum(r[6] or 0 for r in rows)
    by_model: dict[str, dict] = {}
    for _, _, model, inp, out, t, calls, _st in rows:
        key = model or "unknown"
        m = by_model.setdefault(key, {"run_count": 0, "llm_call_count": 0,
                                      "input_tokens": 0, "output_tokens": 0,
                                      "total_tokens": 0})
        m["run_count"] += 1
        m["llm_call_count"] += calls or 0
        m["input_tokens"] += inp or 0
        m["output_tokens"] += out or 0
        m["total_tokens"] += t or 0
    _emit({
        "total_tokens": total, "input_tokens": total_input,
        "output_tokens": total_output, "run_count": runs,
        "llm_call_count": llm_calls, "by_model": by_model,
    })


def cmd_token_usage_timeseries(args: list[str]) -> None:
    days = int(args[0]) if args else 30
    db = _data_root() / "runtime" / "qilin" / "data" / "qilin.db"
    rows = _run_rows(db, days=days)
    by_day: dict[str, dict[str, dict]] = {}
    for _, created, model, inp, out, t, calls, _st in rows:
        if not created:
            continue
        try:
            dt = datetime.fromisoformat(created)
        except ValueError:
            continue
        day = (dt + TZ_DELTA).date().isoformat()
        key = model or "unknown"
        d = by_day.setdefault(day, {})
        m = d.setdefault(key, {"run_count": 0, "llm_call_count": 0,
                               "input_tokens": 0, "output_tokens": 0,
                               "total_tokens": 0})
        m["run_count"] += 1
        m["llm_call_count"] += calls or 0
        m["input_tokens"] += inp or 0
        m["output_tokens"] += out or 0
        m["total_tokens"] += t or 0
    _emit([{"date": day, "by_model": models} for day, models in sorted(by_day.items())])


def _emit(obj) -> None:
    print(json.dumps(obj, ensure_ascii=False))


COMMANDS = {
    "runtime-config": {
        "get": cmd_runtime_config_get,
        "set": cmd_runtime_config_set,
    },
    "token-usage": {
        "stats": cmd_token_usage_stats,
        "timeseries": cmd_token_usage_timeseries,
    },
}


def main() -> None:
    if len(sys.argv) < 3:
        print("usage: product_services.py <group> <cmd> [args...]", file=sys.stderr)
        sys.exit(2)
    group, cmd = sys.argv[1], sys.argv[2]
    try:
        COMMANDS[group][cmd](sys.argv[3:])
    except KeyError:
        print(f"unknown command: {group} {cmd}", file=sys.stderr)
        sys.exit(2)
    except Exception as exc:  # noqa: BLE001
        print(f"error: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
