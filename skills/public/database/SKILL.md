---
name: database
description: >-
  Use this skill for schema changes, migrations, SQL, ORM models, indexes,
  transactions, data backfills, and persistence-layer bugs.

package:
  type: knowledge-only
---

# Database Skill

## Purpose

Make persistence changes safely, with migration and rollback risks considered.

## Workflow

1. Identify the data ownership model and existing migration tooling.
2. Separate schema changes, data backfills, and application behavior when
   possible.
3. Use transactions for multi-step writes that must be atomic.
4. Add indexes only for demonstrated query patterns.
5. Test migrations and important repository queries.

## Review Checklist

- Migrations are deterministic and do not depend on local state.
- Nullable/default behavior is explicit for existing rows.
- Queries avoid N+1 access and unbounded reads.
- Constraints match application invariants.
- Backfills are restart-safe when they may run on real data.
