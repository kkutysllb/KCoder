---
id: release-notes
name: Release Notes
---
# Release Notes Skill

Compile user-facing release notes and upgrade guidance from git history.

## Process

### 1. Gather Changes
```bash
# Between two tags
git log v1.2.0..v1.3.0 --oneline --no-merges
# Or since last release
git log $(git describe --tags --abbrev=0)..HEAD --oneline --no-merges
```

### 2. Categorize
Sort every change into:
- **✨ New Features** — user-visible capabilities
- **🐛 Bug Fixes** — corrected behaviors
- **⚡ Performance** — speed/resource improvements
- **💥 Breaking Changes** — requires user action
- **🔧 Internal** — refactors, deps (brief or omitted)

### 3. Write for Users
- Lead with impact, not implementation: "Exports now support PDF format" not "Added pdf export module"
- Group related commits into single entries
- Reference issue/PR numbers where available
- Keep each entry to one line

### 4. Upgrade Notes
For breaking changes, always include:
- What changed and why
- Migration steps (concrete commands or code changes)
- Timeline/deprecation schedule if applicable

## Output Format

```markdown
# v1.3.0 — 2024-01-15

## ✨ New Features
- Feature description (#123)

## 🐛 Bug Fixes
- Fix description (#456)

## 💥 Breaking Changes
- Change description + migration steps

## Upgrade Guide
1. Step one
2. Step two
```

## Rules

- Never include internal implementation details users don't need
- Verify version numbers against actual tags
- Write in the project's primary language (check existing changelogs)
- If no conventional commits exist, infer categories from diff analysis
