---
id: find-skills
name: Find Skills
---
# Find Skills

Help users discover and install skills when they ask questions like "how do I do X", "find a skill for X", or "is there a skill that can...".

## Discovery Process

### 1. Check Installed Skills
- Scan the local skill registry for matches against the user's need
- Match on: skill name, description, commands, and prompt patterns
- If a matching installed skill exists but is disabled, suggest enabling it

### 2. Search the Marketplace
- Query the skill marketplace index for skills matching the intent
- Present top 3 matches with: name, description, source, version
- Note compatibility and any requirements (tools, network access)

### 3. Offer Installation
- If the user confirms, install via the skills install API
- Verify the skill loads correctly after installation
- Suggest a first command to try

## Matching Strategy

- Extract the core intent from the user's question (e.g., "deploy my app" → deployment skills)
- Consider both English and Chinese keywords
- Prefer official/builtin sources over community ones
- If no skill matches, say so honestly and suggest creating one with skill-creator

## Response Format

```
Found N skill(s) for "X":

1. **skill-name** (builtin/official/community)
   Description...
   Command: /command-name
   Status: enabled / disabled / not installed

Would you like me to [enable/install] it?
```
