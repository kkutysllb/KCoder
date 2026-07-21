---
id: pi-planning-with-files
name: PI Planning with Files
---
# PI Planning with Files

Manus-style file-based planning for complex, multi-step tasks.

## The Three Files

- **task_plan.md** — phases with checkboxes; the single source of truth for what's next.
- **findings.md** — research results, decisions, and discovered constraints with sources.
- **progress.md** — current state snapshot: what's done, what's in flight, blockers.

## Workflow

1. On task start, create all three files with initial structure.
2. Break work into phases; each phase into checkable items.
3. Update checkboxes and progress.md as work proceeds — never let files go stale.
4. Log findings immediately when discovered (they will be forgotten otherwise).
5. On session start (or after /clear), read all three files first to recover context.

## When to Use

- Multi-step projects, research tasks, anything requiring 5+ tool calls.
