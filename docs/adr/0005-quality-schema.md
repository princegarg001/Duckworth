# 0005 — A `quality` schema for the vendor's own numbers

**Status:** Accepted · **Date:** 2026-08-27

## Context

The dataset ships pre-computed artefacts alongside the raw ball-by-ball: per
innings batting and bowling cards, innings totals, and the official league
table. There were three options.

1. **Serve them.** Fast to build. Means publishing numbers we did not compute
   and cannot explain, and the ball-by-ball becomes decorative.
2. **Discard them.** Clean. Throws away the only independent check available on
   the derivation.
3. **Quarantine them and assert against them.**

## Decision

Option 3. A fourth database schema, `quality`, holding the vendor's aggregates.
Nothing in it is ever served. It exists so `ingest verify` can prove that what
we derived from `core.delivery` equals what the provider claims.

## Why

This is the difference between "the tests pass" and "the numbers are right". A
test suite written against our own output can only prove internal consistency —
it will happily confirm that a wrong number is stably wrong.

Asserting against an independently produced figure catches the class of bug that
unit tests structurally cannot: a mis-scoped extra, a ball counted twice, a
wicket credited to the wrong bowler, a phase boundary off by one. Eleven of the
23 checks are reconciliations of this kind, and they cover every batting,
bowling and extras line in the season.

The strongest of them requires the derived points table to equal the published
standings exactly — including net run rate to three decimals, which is sensitive
to every one of those failure modes at once.

## Consequences

- Four schemas rather than three, each with a stated guarantee: `staging` (raw,
  disposable), `core` (the truth), `marts` (derived reads), `quality` (asserted
  against, never served).
- Storage cost is trivial and the boundary is explicit, so nobody can serve a
  `quality` row by accident.
- Checks carry a severity. `vendor_extras_components_self_consistent` is
  `warn`, because it flags a defect in the *source* — one innings whose extras
  components sum to 12 against its own stated total of 11 — rather than in our
  derivation. It stays visible on every run without blocking a deploy, and it
  starts failing if the source ever changes.
