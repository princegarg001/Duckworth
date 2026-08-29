# 0006 — Keyset pagination, with opaque cursors

**Status:** Accepted · **Date:** 2026-08-27

## Context

Three list endpoints (`/v1/matches`, `/v1/players`, `/v1/matches/{id}/deliveries`)
need pagination.

## Decision

Keyset pagination on a total sort key. The cursor is base64url of a small JSON
payload and is documented as opaque — clients pass back `page.nextCursor`
verbatim and never construct one.

## Why

`OFFSET n` makes Postgres produce and discard `n` rows before returning
anything, so the cost of page 400 is proportional to 400 pages. A keyset
predicate (`WHERE (match_date, id) < ($1, $2)`) seeks directly into an index and
costs the same on every page.

At 74 matches neither is measurably slow. The choice is about which pattern the
codebase teaches: offset pagination is the thing that works fine until the day
it does not, and by then it is in six endpoints and a frontend.

Keyset also fixes a correctness bug offset has and people forget about: if a row
is inserted while a client is paging, offset pagination silently repeats or
skips a row across the boundary. A keyset cursor cannot.

**Opaque** because the cursor encodes the sort key. Publishing its structure
would make it API surface, and changing a sort order later would then be a
breaking change. As an opaque token it stays an implementation detail.

## Consequences

- Sorting is constrained to indexed total orders. `(match_date, id)` for
  matches, `(full_name, id)` for players, `(innings_no, delivery_seq)` for
  deliveries — every one backed by a unique index, so the order is total and the
  seek is a single index descent.
- Jumping to "page 7" is impossible by design. No endpoint here needs it; small
  fixed collections (seasons, venues, teams) are returned whole instead.
- `hasMore` comes from fetching `limit + 1` rows and discarding the extra,
  rather than a second `COUNT(*)` — which would double the work on every list
  request to answer a question nobody asked.
- A malformed cursor returns 422 rather than silently restarting from the first
  page, which would look to a client like an infinite list.
