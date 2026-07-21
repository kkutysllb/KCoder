---
id: skill-creator
name: Skill Creator
---
# Skill Creator

Create new skills, modify and improve existing skills, and validate skill structure.

## Skill Package Structure

Every skill is a directory containing:

```
my-skill/
├── skill.json    # Manifest (required)
├── SKILL.md      # Entry prompt (required)
└── *.md          # Optional assets referenced in manifest
```

## Manifest Schema (specVersion 1.0)

```json
{
  "specVersion": "1.0",
  "id": "kebab-case-id",
  "name": "Human Readable Name",
  "description": "One sentence: what + when",
  "version": "1.0.0",
  "category": "development|review|planning|workflow|integration|meta",
  "priority": 0,
  "entry": "SKILL.md",
  "activation": {
    "commands": ["/command-name"],
    "promptPatterns": ["\\b(regex|patterns)\\b"],
    "fileTypes": [".ext"],
    "autoActivate": false
  },
  "commands": [{
    "id": "command-name",
    "alias": ["别名"],
    "description": "What the command does",
    "injectPrompt": "Instruction injected when activated..."
  }],
  "tools": {
    "allowed": ["read", "edit", "write", "bash", "grep", "find"],
    "declarations": [],
    "mcpServers": {}
  },
  "contributes": { "chatMenu": [], "quickTask": [] },
  "permissions": {
    "workspace": "read|write",
    "network": false,
    "exec": "none|workspace",
    "requiresApproval": "on-request"
  },
  "assets": []
}
```

## SKILL.md Writing Guide

1. YAML frontmatter with `id` and `name`
2. H1 title matching the skill name
3. One paragraph: when to use this skill
4. Structured process sections (numbered steps)
5. Rules/constraints section
6. Anti-patterns if relevant

## Quality Checklist

- [ ] id is unique, kebab-case, matches directory name
- [ ] description answers "what" and "when"
- [ ] promptPatterns use word boundaries, include Chinese aliases
- [ ] tools.allowed is minimal (principle of least privilege)
- [ ] injectPrompt is actionable and specific
- [ ] SKILL.md is under 2000 words (budget-aware)
