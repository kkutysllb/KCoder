from .features import Next, Prev, RuntimeFeatures

__all__ = [
    "DeltaThreadState",
    "Next",
    "Prev",
    "RuntimeFeatures",
    "SandboxState",
    "ThreadState",
    "create_qilin_agent",
    "make_lead_agent",
]


def __getattr__(name: str):
    if name == "create_qilin_agent":
        from .factory import create_qilin_agent

        globals()[name] = create_qilin_agent
        return create_qilin_agent
    if name == "make_lead_agent":
        from .lead_agent import make_lead_agent
        from .lead_agent.prompt import prime_enabled_skills_cache

        # LangGraph resolves qilin.agents:make_lead_agent when registering
        # the graph. Prime at that explicit entrypoint instead of at package
        # import time so lightweight submodules can be imported without pulling
        # in the whole tool/subagent graph.
        prime_enabled_skills_cache()
        globals()[name] = make_lead_agent
        return make_lead_agent
    if name in {"DeltaThreadState", "SandboxState", "ThreadState"}:
        from .thread_state import DeltaThreadState, SandboxState, ThreadState

        exports = {
            "DeltaThreadState": DeltaThreadState,
            "SandboxState": SandboxState,
            "ThreadState": ThreadState,
        }
        globals().update(exports)
        return exports[name]
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
