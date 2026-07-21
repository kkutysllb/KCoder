---
id: executing-plans
name: Executing Plans
---
# Executing Plans

Use when you have a written implementation plan to execute, with review checkpoints between stages.

## Execution Protocol

### 1. Load the Plan
- Read the plan document fully before touching any code
- Identify discrete stages/phases and their success criteria
- Note dependencies between steps (what must complete before what)

### 2. Execute Stage by Stage
For each stage:
1. Announce which stage you're starting
2. Implement all changes for that stage
3. Run verification (build/test/lint as appropriate)
4. Report: what was done, what passed, any deviations from plan

### 3. Checkpoint Discipline
- **Never skip verification** between stages
- If a stage fails verification, fix it before moving on
- If the plan needs adjustment, state the deviation explicitly and why
- Keep a running progress tracker (todo list) visible to the user

### 4. Completion
- Run full verification suite at the end
- Summarize: stages completed, deviations made, final state
- Suggest next steps if the plan has follow-up phases

## Rules

- Follow the plan's order unless dependencies force reordering
- Small, verifiable increments beat big-bang implementation
- If blocked on a stage, report the blocker rather than silently skipping
- Preserve plan traceability: reference stage numbers in commit-worthy work
