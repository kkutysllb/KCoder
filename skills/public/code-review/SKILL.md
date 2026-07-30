---
name: code-review
description: >-
  Use this skill when the user asks to review code, check for issues, audit
  quality, or inspect changes. Trigger on requests like "review this code",
  "check this PR", "what's wrong with this code", "audit this change",
  "review my diff", "is this code good", or when the user shares a diff or
  pull request for feedback. Also trigger for security review requests.

package:
  type: knowledge-only
---

# Code Review Skill

## Overview

A structured code review process that identifies bugs, security issues,
performance problems, and design flaws before code reaches production.
The review is constructive — every issue includes a suggested fix.

In OClaw Coding, this is an **embedded Qiongqi review skill**. The review must
use the current project diff, Qiongqi task changes, and Qiongqi event stream as
evidence. Do not produce generic praise or unsupported findings.

## OClaw Review Sources

Use these sources in order:

1. **Project Diff** — current working-tree changes, file status, additions,
   deletions, and unified hunks.
2. **Qiongqi Task Changes** — files modified by the active Coding Agent
   session, grouped by task id.
3. **Qiongqi Events** — tool policy decisions, file changes, diff summaries,
   test/lint signals, ROI/session metadata.

Each finding should be traceable to at least one file, task change, or event.

## Structured Finding Contract

Every review finding should map to this shape:

- `severity`: `critical`, `major`, `minor`, or `nitpick`
- `category`: `security`, `correctness`, `tests`, `performance`, `risk`,
  `maintainability`, or `style`
- `file`: repo-relative file path when applicable
- `line`: changed line when known
- `task_id`: Qiongqi task id when the issue came from a task change
- `message`: concise issue statement
- `suggestion`: concrete next action
- `evidence`: short references to diff hunks, task changes, or events

If there is no concrete issue, say that no blocking issue was found. Do not
invent findings to fill space.

## Automatic Fix Boundary

OClaw may offer one-click fixes only when the fix is deterministic and can be
validated against the current file content. Prefer small patches that replace
one stale-safe text range. Do not auto-apply broad rewrites, ambiguous logic
changes, dependency upgrades, or security-sensitive fixes that require human
judgment.

Current safe automatic fix class:

- Python single-line hardcoded secret assignment -> `os.environ.get(...)`, with
  `import os` inserted when missing.

## PR-Level Review Boundary

For PR-level review, use local git context instead of remote platform APIs:

- merge base against the selected base ref
- commit list between merge base and `HEAD`
- aggregate diff between merge base and `HEAD`
- Qiongqi task changes and events as supporting evidence

Remote PR comments, approvals, and platform-specific checks are outside this
skill boundary.

## Review Process

### Step 1: Understand the Context

Before evaluating individual lines:

1. **Read the commit message and PR description** to understand the
   intent. Use `git_log` and `git_diff` to see the full change set.

2. **Identify the scope.** Is this a bug fix, a new feature, a refactor,
   or a hotfix? The review focus differs for each.

3. **Check the surrounding code.** Use `read_file_lines` to read the
   files being modified in their entirety — context is essential.

### Step 2: Review by Category

Review the diff through each lens below, in order of severity:

#### Correctness (must-fix)

- **Logic errors:** Off-by-one, wrong condition, inverted comparison
- **Null/None handling:** Missing checks, potential AttributeError
- **Error handling:** Swallowed exceptions, missing error paths
- **State management:** Race conditions, mutation of shared state
- **Edge cases:** Empty input, very large input, unicode, timezone

#### Security (must-fix)

- **Injection:** SQL injection, command injection, path traversal
- **Authentication/Authorization:** Missing permission checks, IDOR
- **Secrets:** Hardcoded passwords, API keys in source
- **Input validation:** Trusting user input without sanitization
- **Dependencies:** Known vulnerabilities in new packages

#### Performance (should-fix)

- **N+1 queries:** Database access inside a loop
- **Unbounded queries:** Missing pagination, loading all records
- **Redundant work:** Computing the same value in a loop
- **Memory leaks:** Unbounded caches, circular references
- **Blocking calls:** Synchronous I/O in async context

#### Design (discuss)

- **Single Responsibility:** Does the change make existing classes too large?
- **Coupling:** Does the code introduce unnecessary dependencies?
- **Abstraction level:** Is the new code at the right level of abstraction?
- **Naming:** Do the names accurately describe what the code does?
- **Consistency:** Does the code follow existing patterns in the codebase?

#### Style (nit)

- **Formatting:** Indentation, trailing whitespace, line length
- **Documentation:** Missing docstrings for public APIs
- **Imports:** Unused imports, wrong import order
- **Conventions:** Naming conventions, file organization

### Step 3: Provide Actionable Feedback

For each issue found:

1. **Categorize:** Tag as [must-fix], [should-fix], [discuss], or [nit]
2. **Show the location:** File + line number
3. **Explain the issue:** Why it's a problem, not just what
4. **Suggest a fix:** Provide concrete code, not vague direction

**Good feedback example:**
> [must-fix] `order_service.py:45` — The discount is applied after tax
> calculation, which means it reduces the tax-inclusive price. Move the
> discount application before `calculate_tax()`:
> ```python
> subtotal = apply_discount(subtotal, discount_code)
> tax = calculate_tax(subtotal)
> ```

**Bad feedback example:**
> This looks wrong, you should fix it.

### Step 4: Summarize

After the detailed review, provide a one-paragraph summary:

- Overall assessment: approve, request changes, or block
- Count of issues by severity
- Highlight the most critical issue if any

## Review Checklist

Use this quick checklist for every review:

- [ ] Does the code do what the commit message says?
- [ ] Are there tests for the new behavior?
- [ ] Do existing tests still pass?
- [ ] Are edge cases handled?
- [ ] Is input validated at trust boundaries?
- [ ] Are errors handled, not swallowed?
- [ ] Is there anything security-sensitive?
- [ ] Is the code readable without re-reading?
- [ ] Does the naming make intent clear?
- [ ] Is this change consistent with the codebase patterns?

## Anti-Patterns

- **Bikeshedding:** Spending 20 comments on naming while missing a logic bug
- **Style obsession:** Demanding formatting changes that the linter handles
- **Scope creep:** Requesting features or refactorings unrelated to the PR
- **Vagueness:** "This is hard to follow" without explaining *what* is confusing
- **Personal preference as rule:** "I prefer X" is not the same as "X is better because Y"
