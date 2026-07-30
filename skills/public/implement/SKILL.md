---
name: implement
description: >-
  Use this skill when the user asks to implement a feature, add functionality,
  or build something new in code. Trigger on requests like "implement this
  feature", "add this function", "create this endpoint", "build this module",
  "write a function that", "add support for", or when the user provides a
  specification, requirements document, or user story for implementation.

package:
  type: knowledge-only
---

# Implement Feature Skill

## Overview

A disciplined feature implementation workflow that moves from requirements to
working, tested code. Each step produces a verifiable artifact, so progress
can always be assessed.

## Implementation Workflow

### Phase 1: Understand the Requirements

Before writing any code:

1. **Read the full request.** Restate the requirement in your own words
   to confirm understanding. Identify any ambiguities or missing details.

2. **Explore the codebase.** Use `search_code` and `find_files` to find:
   - Similar existing features to follow as patterns
   - The modules where new code should live
   - Interfaces or base classes to extend
   - Configuration files to update

3. **Identify the blast radius.** What existing code will be affected?
   What tests might need updates? What APIs will change?

4. **Choose the approach.** When multiple implementations are possible,
   pick the one that:
   - Follows existing codebase patterns
   - Requires the fewest new dependencies
   - Is easiest to test and maintain
   - Leave notes for the user on rejected alternatives

### Phase 2: Implement

1. **Start from the boundary.** Define the public interface first —
   function signatures, class APIs, route handlers, endpoint shapes.
   This forces you to think about the contract before the implementation.

2. **Write the implementation.** Move from the outermost layer inward:
   - API route → Service → Data layer
   - Or: Public function → Internal helpers → Utilities

3. **Keep functions small.** Each function should do one thing. If you
   need a comment to explain what a block does, consider extracting it
   into a named function.

4. **Handle errors at boundaries.** Validate input at the system edge
   (API, DB, user input). Throw early. Return meaningful errors, not
   generic "something went wrong".

5. **No silent failures.** Do not use bare `except: pass`. If you catch
   an exception, either handle it, log it, or re-raise it.

### Phase 3: Test

1. **Write tests alongside the code.** Not after — alongside. For each
   piece of logic:
   - Happy path (normal input, expected result)
   - Edge cases (empty input, boundary values, very large input)
   - Error cases (invalid input, missing dependencies, timeout)

2. **Use the right test level:**
   - Unit tests for pure logic (fast, isolated)
   - Integration tests for database/API interactions
   - E2E tests for critical user flows (sparingly)

3. **Run tests.** Use `run_tests` to execute. If the project has a
   linter, run `run_linter` too.

### Phase 4: Review and Commit

1. **Self-review the diff.** Use `git_diff` to review every line. Ask:
   - Does this code do what the requirement asked for?
   - Is there anything that would surprise a reviewer?
   - Did I leave any debug code or TODOs?

2. **Commit with a clear message.** Use Conventional Commits:
   ```
   feat: add user profile image upload endpoint
   fix: handle empty cart in checkout total calculation
   ```

3. **Update documentation.** If the feature adds a new API, config
   option, or behavior, document it in the relevant docs.

## Quality Gates

Before considering the implementation done:

- [ ] All tests pass (`run_tests`)
- [ ] No linter errors (`run_linter`)
- [ ] No debug code left in the diff
- [ ] Error cases are handled, not swallowed
- [ ] Input is validated at trust boundaries
- [ ] Naming makes intent clear without comments
- [ ] New code follows existing codebase patterns
- [ ] Commit message follows conventions

## Common Pitfalls

### Over-Engineering
- Do not add abstractions "for the future." Implement what is needed now.
- Do not add configuration options for things that have one obvious behavior.
- Do not build a generic framework when a specific function would do.

### Under-Testing
- "It works on my machine" is not a test.
- Testing only the happy path means production will find the other paths.
- Mocking everything means you are testing your mocks, not your code.

### Scope Drift
- The user asked for X. Implement X. Note Y and Z as follow-ups, but
  do not implement them unprompted.
- If you discover a bug in unrelated code, report it — do not fix it
  in the same change.

### Premature Optimization
- Profile before optimizing. Do not guess where the bottleneck is.
- Readable code that is "fast enough" beats clever code that is 2% faster.
- Optimize data structures and algorithms first, micro-optimizations last.
