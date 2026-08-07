"""Multi-agent orchestration package (v2.0.0).

编排层构建在 subagents 执行基座之上：handoff 协议（本包）、并行批次
（subagents.batch）、消息总线（inbox）、Orchestrator 图（graph）与
协作模式（patterns）。
"""

from qilin.orchestration.handoff import AgentHandoff, HandoffError, HandoffResult

__all__ = ["AgentHandoff", "HandoffError", "HandoffResult"]
