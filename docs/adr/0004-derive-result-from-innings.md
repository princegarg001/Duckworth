# 0004 — Derive the result kind from cricket, not from `result_type`

**Status:** Accepted · **Date:** 2026-08-28

## Context

`match_info.result_type` is documented as 1 for a runs margin and 2 for a
wickets margin. Profiling found it **disagrees with the same file's own
`status_note` prose in 49 of 74 matches** — for example, match 27 has
`result_type: 2` alongside "Royal Challengers Bangalore won by 16 runs."

Separately, 11 matches have an empty `win_margin`.

## Decision

Ignore `result_type` entirely. Derive the margin kind from which innings the
winner batted in. Take the margin from `win_margin`, falling back to parsing the
"won by N" clause of `status_note`.

## Why

The margin kind is not really a data field — it is a consequence of the laws of
cricket. A side that bats first and wins has defended a total, so it wins **by
runs**. A side that bats second and wins has reached the target with wickets in
hand, so it wins **by wickets**. There is no third possibility for a decided
match.

That derivation needs only two facts we already hold with certainty: who won,
and who batted first. Both come from `core`.

Checked against the prose across the whole season: **74 of 74 agree.** The
vendor's field agrees with 25.

The general principle: when a source field and the domain disagree, and the
domain can determine the answer from facts you trust, the domain wins. A field
that is wrong two thirds of the time is not a field, it is noise.

## Consequences

- `deriveResult` lives in `packages/domain` with tests, not in the ingest, so
  the rule is stated once and can be reasoned about in isolation.
- `disagreesWithNote` cross-checks every derived result against the prose during
  ingest and reports any disagreement. It currently reports none; if the source
  changes shape, that becomes visible immediately rather than silently.
- A tie or a no-result would need explicit handling — neither occurs in IPL
  2022, and `ResultKind` already carries `tie`, `no_result` and `super_over`.
