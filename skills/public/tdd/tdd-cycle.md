# TDD cycle reference

```
RED ─────► write test ──► run ──► fails for the right reason
GREEN ────► implement ───► run ──► passes
REFACTOR ─► improve ─────► run ──► still passes
```

- One behavior per cycle.
- If a test fails for the wrong reason (import error, typo), fix the cause before counting it as Red.
- Keep cycles small; a big jump from Red to Green usually means the test was too broad.
