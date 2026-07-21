---
id: subagent-driven-development
name: Sub-agent Driven Development
---
# Sub-agent Driven Development

Execute implementation plans by dispatching independent tasks to sub-agents.

## When to Use

- The plan contains 2+ tasks with no shared state or ordering dependency.

## Workflow

1. **Decompose** — split the plan into tasks that touch disjoint files/modules.
2. **Brief each sub-agent** — self-contained prompt: goal, context, constraints, exact deliverable, and what to report back.
3. **Dispatch in parallel** — launch independent tasks concurrently.
4. **Verify** — check each result against its deliverable spec; run tests per task.
5. **Integrate** — merge results, resolve interface mismatches, run the full suite.

## Rules

- Never dispatch tasks that share mutable state or file overlap.
- Each sub-agent is stateless: put ALL needed context in the prompt.
- The orchestrator owns integration testing — sub-agents only verify their slice.
