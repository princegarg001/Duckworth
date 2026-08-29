# Data model

Grain: **one row per delivery.** 17,912 of them. Everything else is derived and
can be rebuilt from that table plus the migrations.

---

## Four schemas, four guarantees

| Schema | Contents | Guarantee |
|---|---|---|
| `staging` | Raw landed rows | None. Disposable. |
| `core` | Normalised truth | Aggressively constrained. Every API figure derives from here. |
| `marts` | Ten materialised views | Rebuildable from `core` at any time. |
| `quality` | The vendor's own aggregates | **Never served.** Exists to be asserted against. |

The `quality` schema is the unusual one; ADR 0005 explains why it exists.

---

## The eight source defects

Profiling the dataset before writing any schema surfaced eight problems. Each
would have been silently absorbed by a schema drawn from the assignment brief.

### 1. `result_type` is wrong in 49 of 74 matches

The field claims 1 = runs, 2 = wickets. It contradicts the same file's own
`status_note` two thirds of the time — match 27 reads `result_type: 2` beside
"Royal Challengers Bangalore won by 16 **runs**".

**Resolution:** ignore it. The margin kind follows from which innings the winner
batted in — bat first and win, you won by runs; chase and win, you won by
wickets. That derivation agrees with the prose on **74/74**. See ADR 0004.

### 2. `(over, ball)` is not unique — 729 collisions

On a wide or no-ball the source reuses the ball number. Across the season 688
pairs appear twice, 37 three times and 4 four times.

**Resolution:** `delivery_seq`, assigned monotonically at transform time and
constrained `UNIQUE (innings_id, delivery_seq)`. It is the ordering key for
every query, every cursor and every chart. A check asserts it runs 1..N with no
gaps in every innings.

### 3. `over` is indexed differently per event kind

`ball` and `wicket` entries number overs 0–19. `overend` entries number them
1–20.

**Resolution:** `overend` entries are never read for their over, because they
are not deliveries at all — see the next item. `core.delivery.over_no` is
0-indexed throughout, and the API documents that over 0 is the first over.

### 4. `commentaries` mixes three event kinds

17,001 `ball`, 911 `wicket`, 2,837 `overend`. An `overend` is an over summary
carrying no bowler, striker or runs; a `wicket` **is** a delivery and carries
all three.

**Resolution:** deliveries are `event != 'overend'`. Treating all three as balls
inflates the count by 16%; treating only `ball` as a delivery loses all 911
wicket balls.

### 5. One dismissal has no delivery

There are 912 dismissals on the scorecards and 911 wicket events in the
commentary. The missing one is Rahul Tripathi's **retired hurt** — it did not
happen on a ball.

R Ashwin's **retired out** (the first in IPL history) *does* sit on a delivery.
The two retirements are different events and collapsing them corrupts the wicket
count.

**Resolution:** `dismissal` is its own table with a **nullable** `delivery_id`,
constrained so that only a `retired_hurt` may be null:

```sql
CONSTRAINT dismissal_delivery_required
  CHECK (delivery_id IS NOT NULL OR kind = 'retired_hurt')
```

Had dismissals been a column on `delivery`, that row would have had to be
invented, dropped, or attached to the wrong ball.

### 6. Three deliveries have components that do not sum

Three rows read `run: 5` with `noball_run: 1` and every other component zero.
The commentary calls them "5 no ball": one run is the penalty, the other four
were run without the bat and the source dropped them.

**Resolution:** the residual is recovered as **byes**, by elimination. It is not
off the bat — the scorecard's batting figures agree with our `bat_runs`, so
adding it there breaks that reconciliation. It is not the no-ball penalty — the
scorecard charges the bowler only the single run. Byes are precisely the
category for "runs to the batting side, not off the bat, not charged to the
bowler".

The repair is printed on every ingest run and asserted by
`delivery_components_sum_to_total`.

### 7. Two deliveries list the striker twice

The two-element `batsmen` array — which is how the non-striker is identified at
all, since the source never names one — contains the same player twice on two
of 17,912 deliveries.

**Resolution:** recovered from the previous pair at the crease. The pair only
changes on a wicket or between overs, so the previous delivery's pairing still
holds. Resolves both cases; the other 17,910 resolve directly.

### 8. Umpires arrive as one comma-ambiguous string

```
"Nitin Menon(India), Rohan Pandit(India), Saiyed Khalid(India, TV)"
```

`split(',')` produces four officials, the fourth named `TV)`. On all 74 matches.
Spacing before the bracket is also inconsistent between rows, so the same person
appears as `Menon(India)` and `Menon (India)`.

**Resolution:** split on **top-level** commas only, tracking parenthesis depth,
then parse role and country from the parenthetical. Names are
whitespace-normalised before the `UNIQUE` lookup so both spellings resolve to
one `core.official` row. 31 distinct officials.

---

## Defects reported rather than absorbed

Two more, where the source is wrong but our derivation is right, so the check
warns rather than fails:

- **One innings' extras do not add up.** Components sum to 12 against a stated
  total of 11. The ball-by-ball agrees with the total. `core.innings_extras` is
  therefore **derived from deliveries**, and the vendor's version lives in
  `quality.source_innings_total` to be compared against.
- **11 matches have an empty `win_margin`.** Recovered from the "won by N"
  clause of the prose, which agrees with `win_margin` in every case where both
  are present.

---

## Constraints that make bad rows unstorable

The philosophy: if a bad row cannot exist, no API code needs to defend against
it.

```sql
-- A winner must have played the match
CHECK (winner_id IS NULL OR winner_id IN (team_a_id, team_b_id))

-- A decided match has both a winner and a margin, or neither
CHECK ((result IN ('runs','wickets')) = (winner_id IS NOT NULL AND win_margin IS NOT NULL))

-- A delivery cannot be both a wide and a no-ball
CHECK (NOT (wide_runs > 0 AND noball_runs > 0))

-- A player cannot bat against themselves
CHECK (striker_id <> non_striker_id)

-- Bowler credit and bowler presence must agree, so a run-out can never
-- become a bowler's wicket
CHECK (credits_bowler = (bowler_id IS NOT NULL))

-- Only a retired hurt may exist without a delivery
CHECK (delivery_id IS NOT NULL OR kind = 'retired_hurt')
```

### Generated columns

Computed by Postgres, so no application code path can write a row that
disagrees with itself:

| Column | Definition | Why |
|---|---|---|
| `extra_runs` | `wide + noball + bye + legbye` | Single definition of "extras" |
| `is_wide` | `wide_runs > 0` | |
| `is_noball` | `noball_runs > 0` | |
| `is_legal_ball` | `wide_runs = 0 AND noball_runs = 0` | Wides and no-balls do not count toward the over |
| `counts_as_ball_faced` | `wide_runs = 0` | Balls faced excludes wides but **includes** no-balls |

`total_runs` is deliberately *stored*, not generated: three deliveries have
components that do not sum, innings totals reconcile on the reported total, and
a generated column would make those three rows unstorable.

---

## Why no partitioning

17,912 delivery rows. The whole table fits comfortably in shared buffers, and
every access path is indexed. Partitioning here would add planning overhead,
constrain unique indexes, and complicate the matview refresh — in exchange for
nothing.

The threshold to revisit is roughly **50M rows**, or the point where a
single-season scan exceeds the p99 latency budget. At that size, range
partitioning by `season_id` is the obvious first move, since every mart already
filters by it.

Knowing when *not* to reach for a technique is the same skill as knowing when to.

---

## Cricket rules encoded in the model

These are the ones that cost accuracy when they are wrong, and they live in
`packages/domain` with tests rather than being re-derived per query.

| Rule | Where |
|---|---|
| Balls faced excludes wides, includes no-balls | `counts_as_ball_faced` generated column |
| A bowler is charged runs off the bat, wides and no-balls — never byes or leg-byes | `marts.bowling_innings` |
| A maiden is a completed over conceding nothing chargeable; byes do not break it | `marts.bowling_innings` |
| Run-outs and retirements are dismissals but not the bowler's wicket | `dismissal.credits_bowler` + a check |
| Caught-and-bowled is a `caught` whose sole fielder is the bowler | `refineCaught()` |
| Retired hurt is not a wicket lost; retired out is | `countsAsWicketLost()` |
| Overs are base-6: `17.4 + 0.2 = 18.0` | `overs.ts`, all arithmetic in balls |
| A side bowled out is charged its full quota for NRR | `chargeableBalls()` |
| The points table is league-stage only | `marts.points_table`, `countsTowardStandings()` |
| Phases are overs 1–6 / 7–15 / 16–20 (0-indexed 0–5 / 6–14 / 15–19) | `phase.ts` |
