---
id: writing-plans
name: Writing Plans
---
# Writing Plans

Use when you have a spec or requirements for a multi-step task, before touching code.

## Plan Structure

A good implementation plan contains:

### 1. Summary
- One paragraph: what is being built and why
- Key constraints or decisions already made

### 2. Current State Analysis
- Relevant existing files/modules (with paths)
- Patterns and conventions to follow
- Integration points and dependencies

### 3. Implementation Steps
For each step:
- **Files to create/modify** — exact paths
- **Approach** — what changes and how (concise but concrete)
- **Dependencies** — which steps must precede this one

Group steps into stages that can be verified independently.

### 4. Verification Plan
- How to verify each stage (commands, expected output)
- Final end-to-end verification steps

### 5. Risks & Alternatives
- Known risks and mitigations
- Rejected alternatives (one line each, why rejected)

## Rules

- Plans must be decision-complete: the implementer should not need to make architectural choices
- Reference real file paths from the actual workspace
- Keep steps small enough that each can be verified in isolation
- Prefer modifying existing files over creating new ones
- The plan is a living document — update it when reality diverges
