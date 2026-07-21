---
id: dispatching-parallel-agents
name: Dispatching Parallel Agents
---
# Dispatching Parallel Agents

Run 2+ independent tasks concurrently via separate agents.

## Preconditions

- Tasks are truly independent: no shared files, no ordering constraint.
- Each task's deliverable is verifiable on its own.

## Workflow

1. **Partition** — split work so file/module ownership never overlaps.
2. **Brief** — each agent prompt is fully self-contained:
   - Goal + success criteria
   - All needed context (agents share nothing with you or each other)
   - Exact deliverable + what to report back
3. **Dispatch concurrently** — launch all agents in one batch.
4. **Collect** — verify each report against its success criteria.
5. **Integrate** — merge outputs; run the combined verification suite.

## Rules

- Statelessness is absolute: anything an agent needs must be in its prompt.
- If tasks turn out to overlap, stop and re-partition — don't let agents race on shared files.
