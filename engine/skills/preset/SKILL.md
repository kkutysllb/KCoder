---
id: preset
name: Preset Deployment
---
# Quick Preset Deployment

Deploy Azure OpenAI models to the optimal region automatically.

## Use For

- Quick deployment with sensible defaults
- Automatic optimal-region selection
- Multi-region availability checks / high availability

## Do NOT Use For

- Custom SKU / version / capacity selection (use customize)
- Provisioned throughput deployments (use customize)

## Workflow

1. Check capacity in the current/preferred region first.
2. If insufficient, rank alternatives by remaining quota + latency.
3. Deploy with default SKU and recommended TPM allocation.
4. Report: chosen region, deployment name, endpoint, and alternatives considered.
