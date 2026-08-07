"""Config for token budget middleware."""

from pydantic import BaseModel, Field, model_validator


class TokenBudgetConfig(BaseModel):
    """Configuration for per-run token budget enforcement."""

    enabled: bool = Field(default=False, description="Whether to enable per-run token budget enforcement.")
    max_tokens: int = Field(default=200000, ge=1000, description="Maximum total tokens (input + output) allowed per run.")
    max_input_tokens: int | None = Field(default=None, ge=1, description="Optional separate limit for input tokens only.")
    max_output_tokens: int | None = Field(default=None, ge=1, description="Optional separate limit for output tokens only.")
    warn_threshold: float = Field(default=0.8, ge=0.0, le=1.0, description="Fraction of max_tokens at which a soft warning is injected. E.g., 0.8 means warn at 80% of max_tokens")
    hard_stop_threshold: float = Field(default=1.0, ge=0.0, le=1.0, description=("Fraction of max_tokens at which tool calls are stripped and the agent is forced to produce a final answer. E.g., 1.0 means stop at 100% of max_tokens."))
    per_agent: dict[str, "TokenBudgetConfig"] = Field(default_factory=dict, description="Per-agent budget overrides keyed by agent name; unlisted agents fall back to the global limits.")

    @model_validator(mode="after")
    def validate_thresholds(self) -> "TokenBudgetConfig":
        """Ensure hard stop cannot trigger before the warning."""
        if self.hard_stop_threshold < self.warn_threshold:
            raise ValueError("hard_stop_threshold must be >= warn_threshold")
        return self


def resolve_agent_token_budget(
    agent_name: str, config: TokenBudgetConfig
) -> TokenBudgetConfig:
    """Return the effective token budget for *agent_name*.

    优先返回 ``config.per_agent[agent_name]``（per-agent 配额 override）；
    未配置该 agent 时回退到全局 ``config``。调用方（如 subagent executor /
    registry 构造 per-agent middleware 时）传 ``app_config.token_budget``。
    """
    override = config.per_agent.get(agent_name)
    if override is not None:
        return override
    return config


TokenBudgetConfig.model_rebuild()
