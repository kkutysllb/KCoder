---
name: codebase-analysis
description: >-
  Use this skill before modifying unfamiliar code, when analyzing project
  architecture, finding feature ownership, tracing data flow, or assessing how
  an existing implementation works.

package:
  type: knowledge-only
---

# Codebase Analysis Skill

## Purpose

Understand the existing system before editing it.

## Workflow

1. Locate entry points, route registration, service boundaries, and tests.
2. Search for similar working features and reuse their patterns.
3. Trace data from UI to API to service to persistence or runtime.
4. Identify ownership boundaries and where new behavior belongs.
5. Summarize findings before substantial edits.

## Review Checklist

- The proposed change fits an existing local pattern.
- The implementation does not bypass established helpers.
- Tests are placed near similar existing tests.
- Unknowns are called out rather than hidden.
