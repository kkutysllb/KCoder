---
name: web-accessibility
description: >-
  Use this skill for accessibility work: keyboard navigation, ARIA labels,
  semantic HTML, focus management, contrast, reduced motion, and screen reader
  compatibility.

package:
  type: knowledge-only
---

# Web Accessibility Skill

## Purpose

Make web UI usable with keyboard, screen readers, and assistive technologies.

## Workflow

1. Prefer semantic HTML before adding ARIA.
2. Ensure all interactive controls are keyboard reachable and visibly focused.
3. Give icon-only controls accessible names.
4. Keep DOM nesting valid.
5. Test important flows with keyboard-only navigation.

## Review Checklist

- No `button` inside `button` or invalid interactive nesting.
- Tabs, dialogs, menus, and switches use established accessible primitives.
- Dynamic status changes are visible and not only color-coded.
- Focus is not lost when panels mount or update.
- Contrast and hit targets are acceptable for compact controls.
