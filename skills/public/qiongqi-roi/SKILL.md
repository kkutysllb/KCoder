---
name: qiongqi-roi
description: >-
  Use this skill when recording or analyzing Qiongqi ROI telemetry, token
  economy, tool catalog compression, hidden tool counts, provider usage, or
  session-level efficiency reports.

package:
  type: knowledge-only
---

# Qiongqi ROI Skill

## Purpose

Measure whether Qiongqi context and tool compression are improving Coding Agent
efficiency.

## Workflow

1. Capture provider token usage, visible/hidden tool counts, and fingerprints.
2. Tie ROI reports to the Coding thread id.
3. Keep ROI telemetry separate from user project files.
4. Show summary metrics in the inspector without requiring raw JSON reading.
5. Use ROI data to guide compression or tool policy changes, not to hide
   important evidence.

## Review Checklist

- ROI reports are persisted under `~/.oclaw-coding/{thread_id}`.
- Fingerprints are stable enough to compare sessions.
- Empty ROI state is handled gracefully in the UI.
- Token economy claims are backed by recorded values.
