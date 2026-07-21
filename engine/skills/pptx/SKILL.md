---
id: pptx
name: PowerPoint
---
# PowerPoint (.pptx)

Create, read, edit, and manipulate PowerPoint files.

## Capabilities

- **Create** decks from scratch or from a template (layouts, masters, branding)
- **Read/extract** text, notes, and structure from existing .pptx
- **Edit** content, reorder/merge/split slides, update speaker notes and comments

## Creation Workflow

1. Outline the narrative first (one message per slide); agree with the user.
2. Choose a layout per slide type (title, content, two-column, image).
3. Build with python-pptx; keep text concise (≤6 bullets, short lines).
4. Apply consistent fonts/colors from the template or brand system.
5. Add speaker notes with the detailed talking points.
6. Validate: reopen the file programmatically and verify slide count + content.

## Rules

- Never leave placeholder text in the output.
- Preserve the source template's master/layouts when editing existing decks.
