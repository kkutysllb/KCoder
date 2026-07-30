---
name: performance
description: >-
  Use this skill when the user asks to improve speed, latency, throughput,
  memory use, rendering performance, query efficiency, or startup time.

package:
  type: knowledge-only
---

# Performance Skill

## Purpose

Improve performance with measurement and targeted changes instead of guessing.

## Workflow

1. Define the bottleneck and success metric: latency, throughput, memory,
   bundle size, query count, render count, or startup time.
2. Measure or inspect the current path before changing it.
3. Find the smallest high-impact change: reduce repeated work, bound data,
   batch I/O, cache stable results, or remove unnecessary renders.
4. Preserve correctness and error handling.
5. Add a test or benchmark when the project has a suitable harness.

## Review Checklist

- No unbounded loops, queries, or in-memory collections on user-sized data.
- Async code does not block on synchronous I/O in hot paths.
- Caches have clear keys and invalidation boundaries.
- Frontend changes avoid unstable props and excessive re-rendering.
- Performance claims are backed by measurement or concrete complexity reduction.
