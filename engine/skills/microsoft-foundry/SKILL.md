---
id: microsoft-foundry
name: Microsoft Foundry
---
# Microsoft Foundry Agents

End-to-end Foundry agent lifecycle with azd.

## Use For

- `azd ai agent` scaffold / run / provision / deploy (hosted agents)
- Prompt agent creation and tool attachment
- Batch evaluation, continuous evaluation & monitoring
- Prompt optimizer / Agent Optimizer scaffold
- agent.yaml configuration, RBAC & quota troubleshooting
- Dataset curation from traces; SFT/DPO/RFT fine-tuning

## Do NOT Use For

- Azure Functions / App Service / general Azure deployment
- Generic Azure resource preparation

## Workflow

1. Scaffold with `azd ai agent`; configure `agent.yaml` (model, tools, instructions).
2. Run locally, then provision (RBAC roles, AI Services resource, quota check).
3. Evaluate: batch eval first; add continuous eval + monitoring for production.
4. Optimize: prompt optimizer on eval traces; curate datasets from good traces.
5. Deploy and verify health endpoints.
