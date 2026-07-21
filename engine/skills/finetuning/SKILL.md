---
id: finetuning
name: Fine-tuning
---
# Model Fine-tuning

Fine-tune models on Azure AI Foundry with SFT, DPO, or RFT.

## Use For

- Supervised fine-tuning (SFT) on curated examples
- Preference optimization (DPO) with chosen/rejected pairs
- Reinforcement fine-tuning (RFT) with verifiable reward signals
- Dataset curation, training jobs, deployment, evaluation

## Workflow

1. **Method selection** — SFT for format/skill gaps, DPO for preference alignment, RFT for verifiable reward signals.
2. **Dataset prep** — validate format, deduplicate, check label quality; split train/eval.
3. **Grader calibration** (RFT) — verify graders against human judgments before training.
4. **Submit job** — monitor loss curves and checkpoints; stop early on divergence.
5. **Evaluate** — run the held-out eval; compare against the base model before deploying.
6. **Deploy** — deploy only if eval shows clear, regression-free improvement.
