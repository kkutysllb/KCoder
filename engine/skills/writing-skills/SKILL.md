---
id: writing-skills
name: Writing Skills
---
# Writing Skills

The craft of authoring effective agent skills.

## Anatomy of a Good Skill

1. **Trigger description** — precise conditions (user phrases, file types, task kinds) AND explicit non-triggers. This is the most important line.
2. **Imperative instructions** — "Run X", "Check Y" — not descriptions of what the skill is about.
3. **Checklists over prose** — agents follow steps; they skim paragraphs.
4. **Anti-patterns** — the mistakes the skill exists to prevent.
5. **Verification** — how to confirm the skill was applied correctly.

## Authoring Workflow

1. Study 2–3 existing skills for format conventions.
2. Write the trigger description first; test it against 5 real prompts (would it fire? should it?).
3. Draft instructions from an actual run of the task.
4. Edit ruthlessly — every line must change agent behavior or be cut.
5. Verify: run the skill against a real task before deploying.

## Rules

- One skill = one job. Split overlapping skills.
- Concrete beats comprehensive: 30 precise lines > 200 vague ones.
