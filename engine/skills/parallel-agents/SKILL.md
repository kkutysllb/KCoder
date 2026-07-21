---
id: parallel-agents
name: Dispatching Parallel Agents
---
# Dispatching Parallel Agents

Use when facing 2+ independent tasks that can be worked on without shared state or sequential dependencies.

## When to Parallelize

✅ Good candidates:
- Multiple files needing similar but independent changes (e.g., i18n across components)
- Independent feature modules with no overlapping files
- Research tasks (investigating different libraries/approaches)
- Test writing for independent modules
- Documentation for separate subsystems

❌ Do NOT parallelize:
- Tasks that modify the same file
- Tasks where output of A is input to B
- Database migrations or schema changes
- Anything requiring shared runtime state

## Dispatch Protocol

### 1. Decompose
- Split work into units with zero file overlap
- For each unit, define: scope (files), goal, success criteria
- Verify independence: no unit reads state another unit writes

### 2. Brief Each Agent
Every sub-agent task must include:
- Complete context (cannot see other agents' work)
- Exact file paths it owns
- What NOT to touch
- Verification command for its unit

### 3. Merge & Verify
- Collect all results
- Run integration verification (full build + test suite)
- Check for emergent conflicts (duplicate utilities, inconsistent naming)
- Resolve any integration issues sequentially

## Conflict Prevention

- Assign file ownership exclusively — never let two agents edit the same file
- Shared utilities/types must be created BEFORE parallelizing
- If agents need a common interface, define the contract first, then parallelize implementations

## Rules

- Maximum 4 parallel units (diminishing returns beyond that)
- If decomposition reveals dependencies, restructure into phases instead
- Always run full verification after merge — parallel work increases integration risk
