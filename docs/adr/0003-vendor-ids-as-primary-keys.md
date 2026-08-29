# 0003 — Vendor IDs as primary keys

**Status:** Accepted · **Date:** 2026-08-27

## Context

The source assigns stable integer identifiers to seasons, teams, venues,
players, matches and innings, and reuses them across its whole catalogue. The
conventional advice is to mint surrogate keys and keep the source identifier as
a unique column.

## Decision

Adopt the vendor identifiers as primary keys for those six entities. Use a
surrogate `bigserial` for `delivery` and `dismissal`, which have no natural key
we control.

## Why

Two concrete benefits:

1. **Idempotent re-ingest for free.** Every load is an upsert on the natural
   key. There is no lookup table, no "have I seen this before" query, and no
   staging identity-resolution pass. Re-running the ingest converges on the same
   rows rather than duplicating them.
2. **Traceability.** A row's primary key is the identifier in the source file,
   so any figure the API serves can be traced back to its origin without a join.

`delivery` is the exception because the source has no per-delivery key we own —
but it *does* carry a globally unique `event_id` across all 17,912 rows, which
is stored and constrained `UNIQUE` for the same traceability reason.

## Consequences

- The schema is coupled to one provider's identifier space. A second data source
  for the same entities would collide.
- **The migration path if that happens:** add surrogate keys and a crosswalk
  table (`source_system`, `source_id`, `internal_id`), repoint foreign keys,
  keep the vendor id as a unique column per source. This is a real migration,
  not a free change, and it is the price paid for the two benefits above.
- Accepted because this is a single-provider dataset and the alternative buys
  flexibility that nothing in scope needs.
