---
id: deploy
name: Deploy
---
# Deploy Skill

Deploy applications to cloud platforms with automated setup, build verification, and post-deploy confirmation.

## Deployment Targets

### Vercel (recommended for frontend/Next.js)
```bash
# Install CLI if needed
npm i -g vercel
# Deploy (preview)
vercel --yes
# Deploy to production
vercel --prod --yes
```

### Netlify (static sites)
```bash
npm i -g netlify-cli
netlify deploy --prod --dir=dist
```

### Docker (any backend)
```bash
docker build -t app-name .
docker run -d -p 8080:8080 app-name
```

### Static hosting (simple HTML)
- Build output → any static file server or GitHub Pages

## Deployment Protocol

### 1. Pre-flight Checks
- Detect project type (package.json framework, build scripts)
- Run the build locally first: `npm run build` must pass
- Check for required env vars — warn if missing
- Confirm deployment target with the user before proceeding

### 2. Deploy
- Use non-interactive flags (--yes, --prod) to avoid prompts
- For token auth: guide user to set VERCEL_TOKEN / NETLIFY_AUTH_TOKEN
- Capture the deployment URL from CLI output

### 3. Verify
- Fetch the deployed URL and confirm HTTP 200
- Check that key content renders (not an error page)
- Report: URL, deployment ID, build time

## Rules

- **Always require user approval** before deploying (permissions: requiresApproval=always)
- Never store tokens in code or commit them
- If build fails locally, fix it before attempting deployment
- For production deploys, confirm the branch/state being deployed
- Report costs implications if the platform has usage limits
