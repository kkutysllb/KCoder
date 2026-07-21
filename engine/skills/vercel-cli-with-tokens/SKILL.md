---
id: vercel-cli-with-tokens
name: Vercel CLI with Tokens
---
# Vercel CLI with Token Auth

Non-interactive Vercel operations for CI and automation.

## Setup

```bash
export VERCEL_TOKEN=<access-token>   # create at vercel.com/account/tokens
vercel whoami --token=$VERCEL_TOKEN  # verify
```

## Non-interactive Patterns

- Link: `vercel link --yes --project <name> --token $VERCEL_TOKEN`
- Env: `vercel env add KEY production < secret.txt` or `vercel env pull`
- Deploy: `vercel --yes --token $VERCEL_TOKEN` (preview) / add `--prod` for production

## Rules

- Never print or commit tokens; read from environment only.
- Use scoped tokens (project-level) when possible, not account tokens.
- Always pass `--yes` in automation to avoid interactive prompts hanging CI.
