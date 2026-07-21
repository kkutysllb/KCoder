---
id: slack-gif-creator
name: Slack GIF Creator
---
# Slack GIF Creator

Create animated GIFs that actually work in Slack.

## Slack Constraints

- **Custom emoji**: ≤ 2 MB (aim for < 500 KB), 128×128 recommended
- **Message GIFs**: keep < 2 MB for reliable autoplay; ≤ 480px wide
- **Frames**: fewer frames + lower fps (8–12) = smaller file; loop cleanly

## Workflow

1. Clarify subject + action ("X doing Y") and target (emoji vs message).
2. Generate frames (p5.js / canvas / image tooling) at the target dimensions.
3. Assemble the GIF (gifsicle / ffmpeg / gifenc); optimize palette to ≤256 colors.
4. **Validate** — check file size and dimensions against the constraints above; re-optimize (lossy compression, frame dropping) until compliant.
5. Deliver the .gif path to the user.

## Animation Tips

- Design loops that read as seamless (return to start pose).
- High contrast, thick outlines — GIFs display tiny.
