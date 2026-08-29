# 0002 — Drizzle over Prisma

**Status:** Accepted · **Date:** 2026-08-27

## Context

This platform is roughly 70% analytical SQL: window functions for partnership
reconstruction, `FILTER` aggregates throughout the marts, `CROSS JOIN LATERAL`
for the head-to-head expansion, materialised views refreshed concurrently, and
generated columns.

## Decision

Drizzle ORM with `postgres-js`, plus hand-authored SQL for the materialised
views.

## Why

Prisma is excellent at CRUD over a schema it owns. It is actively unhelpful
here: window functions and CTEs require dropping to `$queryRaw`, which returns
`unknown` and discards the type safety that was the reason to adopt it; it does
not model materialised views, generated columns or partial indexes; and its
migration engine wants to own a schema that in this design is deliberately split
across four namespaces with different guarantees.

Drizzle is SQL-first. The analytical queries are written as SQL and still return
typed rows.

## Consequences

- Materialised views are **not** managed by drizzle-kit. They live as idempotent
  `.sql` files applied after the migrations, because a view holds no durable
  state and re-defining it should not require inventing a migration for every
  change to a `SELECT`. `drizzle.config.ts` documents the split.
- drizzle-kit bundles as CommonJS and cannot resolve NodeNext `.js` specifiers
  in TypeScript sources, so migration generation reads the *compiled* schema.
  `pnpm generate` depends on `build`.
- **`drizzle()` mutates the shared postgres-js client**, installing identity
  serialisers for the timestamp OIDs (1082, 1083, 1114, 1184) so it can do its
  own mapping. Any `Date` passed to a *raw* tagged-template query on that same
  client then reaches the wire protocol unconverted. The ingest passes ISO
  strings for this reason; see `isoFromEpochSeconds`. This cost half an hour to
  find and is exactly the kind of thing worth writing down.
