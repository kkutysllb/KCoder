---
id: capacity
name: Capacity
---
# Capacity Discovery

Discover available Azure OpenAI model capacity across regions and projects.

## Use For

- Find capacity / check quota / where can I deploy
- Capacity discovery across regions and projects
- Quota analysis and model availability comparison

## Do NOT Use For

- Actual deployments (hand off to preset/customize after discovery)
- Quota increase requests (direct the user to Azure Portal)
- Listing existing deployments (use the deployments list API)

## Workflow

1. Enumerate target subscriptions/projects and their Azure OpenAI resources.
2. Query remaining quota per region (TPM/RPM) for the requested model family.
3. Rank regions by: remaining quota, latency to users, data-residency constraints.
4. Report a comparison table and recommend the top 2–3 locations with rationale.
