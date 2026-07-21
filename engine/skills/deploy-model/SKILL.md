---
id: deploy-model
name: Deploy Model
---
# Unified Model Deployment

Single entry point for Azure OpenAI deployments with intent-based routing.

## Routing Rules

| User intent | Route to |
|---|---|
| "deploy model", "set up model" (no specifics) | **preset** — optimal region, sensible defaults |
| explicit version / SKU / capacity / RAI policy | **customize** — guided step-by-step flow |
| "where can I deploy", "find capacity", "check availability" | **capacity** — discovery and comparison |

## Do NOT Use For

- Listing existing deployments (use the deployments list API)
- Deleting deployments
- Agent or project creation (use the respective create flows)

## After Deployment

- Verify deployment health (provisioning state, test call).
- Report endpoint, deployment name, and region to the user.
