---
id: webapp-testing
name: Web App Testing
---
# Web App Testing Skill

Toolkit for interacting with and testing local web applications using Playwright.

## Setup

```bash
# Ensure Playwright is available
npx playwright --version || npm init -y && npm i -D @playwright/test && npx playwright install chromium
```

## Testing Workflow

### 1. Quick Smoke Test (script mode)
```javascript
// test-smoke.mjs
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();

// Capture console errors
const errors = [];
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('pageerror', err => errors.push(err.message));

await page.goto('http://localhost:5173');
await page.screenshot({ path: 'screenshot-home.png', fullPage: true });

// Interact
await page.click('text=Settings');
await page.waitForTimeout(500);
await page.screenshot({ path: 'screenshot-settings.png' });

console.log('Console errors:', errors.length ? errors : 'none');
await browser.close();
```

### 2. What to Verify
- **Page loads** — HTTP 200, no blank screen
- **Console clean** — no JS errors or unhandled rejections
- **Key interactions** — buttons respond, navigation works, forms submit
- **Visual state** — screenshots as evidence for the user
- **Responsive** — test at multiple viewport sizes if relevant

### 3. Reporting
- Attach screenshot paths so the user can view results
- List any console errors verbatim
- Note any elements that failed to load or render

## Rules

- Always confirm the dev server URL/port before testing (check running processes or ask)
- Use `waitForSelector` / `waitForLoadState` instead of arbitrary timeouts where possible
- Save screenshots to a temp directory, report their paths
- If the app requires auth, ask the user for test credentials or a bypass
