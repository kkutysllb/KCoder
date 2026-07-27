# Durable Engine v1.0 Migration (Historical Entry)

Qiongqi Engine v1.0.0 was the initial breaking durable-engine release. Use this guide only when migrating from pre-v1 runners. Deployments already on v1.0 should continue with [the v1.1 migration](./engine-v1.1.md).

## Configuration

Register model profiles with `profileId`, immutable `revision`, `providerId`, `modelId`, `endpointFormat`, capability metadata, and a `credentialRef`. API keys and provider secrets do not belong in engine profiles. A task supplies its authorized profile candidates and can switch the active profile on the next model attempt.

Production multi-instance deployments must use PostgreSQL. SQLite, in-memory and file adapters remain development/conformance adapters. Configure stream cursors with `streamId + seq`; each subscriber owns its own acknowledgement cursor. Private reasoning collection, persistence and subscription are disabled by default.

## State and recovery

Engine v1 uses a new durable namespace. It does not silently read, convert or repair classic/evented/kernel snapshots, legacy task memory, or inline model defaults. Reconcile `waiting_model_resolution`, `waiting_effect_verification` and `waiting_input` explicitly with `resume` and the durable suspension token.

Duplicate model/tool calls are governed by the durable execution ledger. Completed logical requests replay their stored result; uncertain provider effects suspend for resolution instead of being resent. Parent cancellation, budget reservations and Kernel completion are fenced and idempotent.

## Streaming and value accounting

Model text, tool lifecycle, usage, checkpoints and terminal outcomes are published as durable stream events and replayed through SSE. Caller-supplied business value is recorded separately from engine efficiency indicators such as replay/suppression counts, progress-per-cost and avoided waste. ROI is available only when cost and value use the same currency and incurred cost is positive.

The migration is intentionally breaking: configure the new Engine v1 facade and store explicitly, then remove legacy runner/config entrypoints from the embedding product. No hidden vendor fallback is provided.
