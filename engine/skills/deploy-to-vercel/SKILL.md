---
id: deploy-to-vercel
name: Deploy to Vercel
---
# Deploy to Vercel

Deploy applications and websites to Vercel and return the live URL.

## Workflow

1. **Pre-flight** — build the project locally first; never deploy a broken build.
2. **CLI auth** — ensure the Vercel CLI is installed and authenticated (login or token).
3. **Project link** — link to an existing project or create a new one; confirm framework preset and build settings.
4. **Env vars** — sync required environment variables before deploying.
5. **Deploy** — preview by default; production only when the user explicitly asks to go live.
6. **Report** — return the deployment URL and, for production, the alias.

## Notes

- Respect `.vercelignore` and never upload secrets.
- If the deploy fails, read the build logs and fix the root cause — do not retry blindly.
