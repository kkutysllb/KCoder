# Visual Companion — Operating Guide

Detailed conventions for the visual companion offered in [SKILL.md](SKILL.md).
Read this once after the user accepts; follow it for every visual question.

## Core rules

1. **One self-contained HTML file per question.** No frameworks, no CDN
   links, no external assets — the file must render offline in any browser.
2. **Files live in `<workspace>/.dsh/visual-companion/`.** Create the
   directory on first use and add `.dsh/` to the project's `.gitignore` if
   it isn't ignored already. Never commit companion files.
3. **Serve over HTTP, never `file://`.** Start one server per brainstorming
   session and reuse it for every visual:

   ```bash
   python3 -m http.server <port> --directory .dsh/visual-companion
   ```

   Port selection: try 4173, then 4174 … up to 4179; skip any port that
   fails to bind. Remember the port you settled on — every later visual in
   this session reuses it.
4. **Deliver the URL, not the file path.** The user opens
   `http://127.0.0.1:<port>/<file>.html` in their browser.

## Comparison pages (the common case)

When the question is a choice between directions (layout, entry focus,
brand emphasis…), build ONE page with the options side by side:

- A slim header restating the question in one sentence.
- One column per option (`A` / `B` / `C`), identical content blocks in the
  same order so differences compare cleanly — e.g. for a landing page:
  hero treatment, primary action, copy tone, visual weight.
- Each column ends with the concrete trade-off in one line: what you gain,
  what you give up.
- Fixed max-width (~1200px), system font stack, and the project's real
  palette when one exists; otherwise neutral grays. The mockup argues for
  a direction — it is not the final implementation.

## Lifecycle

- Name files by sequence: `01-<slug>.html`, `02-<slug>.html` … so the URL
  history reads as an outline of the session.
- After the user answers a visual question, continue the dialogue in text —
  do not rebuild the page for every message.
- At session end (design approved or user disengages): stop the server
  (kill the background `python3`), leave the files in place, and tell the
  user which directory holds them.

## When NOT to use it

Per SKILL.md: text questions (requirements, trade-off lists, scope
decisions) stay in the terminal. The companion is for seeing, not reading.
