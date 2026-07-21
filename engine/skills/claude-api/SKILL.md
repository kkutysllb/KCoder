---
id: claude-api
name: Claude API
---
# Claude API

Build, debug, and optimize applications using the Anthropic SDK.

## Trigger

- Code imports `anthropic` / `@anthropic-ai/sdk`
- User asks for Claude API features: caching, thinking, tool use, batch, files, citations
- Migrating between Claude model versions

## Skip When

- Code imports `openai` or another provider SDK
- Provider-neutral generic code

## Requirements

1. **Prompt caching is mandatory** — add `cache_control` to system prompts, tools, and long context; verify cache hit rates in usage output.
2. Use the latest SDK patterns: typed client, streaming helpers, message batches for async workloads.
3. **Model migration** — when moving between versions, check deprecation dates, re-test evals, and update any version-pinned logic.
4. Handle rate limits with exponential backoff; surface overloaded errors clearly.
5. Keep API keys out of source; read from environment only.
