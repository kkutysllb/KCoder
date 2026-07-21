---
id: customize
name: Customize Deployment
---
# Customized Model Deployment

Interactive guided deployment with full customization control.

## Use For

- Custom deployment with explicit version / SKU / capacity selection
- RAI policy and content filter configuration
- Advanced options: dynamic quota, priority processing, spillover
- Provisioned throughput (PTU) deployments

## Do NOT Use For

- Quick deployment to the optimal region (use preset)
- Capacity discovery only (use capacity)

## Guided Steps

1. **Model version** — select exact model + version for the workload.
2. **SKU** — GlobalStandard / Standard / ProvisionedManaged; explain trade-offs.
3. **Capacity** — TPM allocation within available quota (check capacity first).
4. **RAI policy** — content filter selection or creation.
5. **Advanced** — dynamic quota, priority processing, spillover as needed.
6. Confirm the full configuration with the user, then deploy and verify health.
