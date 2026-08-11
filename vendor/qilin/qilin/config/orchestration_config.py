"""Orchestration configuration (multi-agent mode, v2.0.0).

``orchestration.mode`` 决定引擎运行形态：

- ``single``（默认，v1.0.0 行为）：lead agent + ``task_tool`` 委派，
  子代理为工具式子代理，调用-返回、用完即弃。
- ``multi``（v2.0.0）：Orchestrator 图编排，``workers`` 注册参与编排的
  子代理，支持并行批次执行与协作模式。
"""

from __future__ import annotations

from enum import StrEnum
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel, Field, field_validator

if TYPE_CHECKING:
    # 运行时在 to_subagent_configs 内导入：qilin.subagents.__init__ 会拉起
    # registry -> sandbox -> qilin.config 链，模块级导入会与 qilin.config
    # 的初始化形成循环（与 qilin/subagents/config.py 的 TYPE_CHECKING 同因）。
    from qilin.subagents.config import SubagentConfig


class OrchestrationMode(StrEnum):
    """Engine runtime mode."""

    SINGLE = "single"  # v1.0.0 行为：lead agent + task_tool 委派
    MULTI = "multi"  # v2.0.0：Orchestrator 图编排


class AgentSpec(BaseModel):
    """A participant agent in multi-agent orchestration.

    与 :class:`SubagentConfig` 同构（运行时经 :meth:`OrchestrationConfig
    .to_subagent_configs` 转为 SubagentConfig 交给 SubagentExecutor），
    额外携带 ``role`` 供 P3 agent 身份使用。
    """

    name: str = Field(min_length=1)
    description: str
    system_prompt: str | None = None
    tools: list[str] | None = None
    disallowed_tools: list[str] | None = None
    skills: list[str] | None = None
    model: str = "inherit"
    max_turns: int = 50
    timeout_seconds: int = 900
    role: str = "worker"  # orchestrator | worker | reviewer


class OrchestrationConfig(BaseModel):
    """``AppConfig.orchestration`` 段。"""

    mode: OrchestrationMode = OrchestrationMode.SINGLE
    max_concurrency: int = Field(default=3, ge=1)
    workers: list[AgentSpec] = Field(default_factory=list)

    @property
    def enabled(self) -> bool:
        return self.mode == OrchestrationMode.MULTI

    def to_subagent_configs(self) -> dict[str, SubagentConfig]:
        """把 ``workers`` 转成 SubagentConfig 注册表（name -> config）。

        ``None`` 的可选字段（tools/disallowed_tools/skills）不显式传入，
        让 SubagentConfig 的默认值生效（如 disallowed_tools 默认排除
        ``task``，防止子代理无限递归委派）。
        """
        from qilin.subagents.config import (
            SubagentConfig,
        )

        result: dict[str, SubagentConfig] = {}
        for w in self.workers:
            kwargs: dict[str, Any] = {
                "name": w.name,
                "description": w.description,
                "system_prompt": w.system_prompt,
                "model": w.model,
                "max_turns": w.max_turns,
                "timeout_seconds": w.timeout_seconds,
            }
            for key in ("tools", "disallowed_tools", "skills"):
                value = getattr(w, key)
                if value is not None:
                    kwargs[key] = value
            result[w.name] = SubagentConfig(**kwargs)
        return result

    @field_validator("workers")
    @classmethod
    def _unique_worker_names(cls, v: list[AgentSpec]) -> list[AgentSpec]:
        names = [w.name for w in v]
        if len(names) != len(set(names)):
            raise ValueError("worker names must be unique")
        return v
