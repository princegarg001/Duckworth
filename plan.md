# IPL Data Platform — End-to-End Build Plan

> Target: a submission that reads like it was built by someone who has shipped and operated systems, not someone completing a checklist.

---

## 0. How this assignment is actually scored

The brief says it outright: *"Code quality, system design, clarity of thought, and production readiness will be valued more than feature count."*

That means the reviewer will spend ~15 minutes and look at, in this order:

1. **The README** — can they understand the whole system in 3 minutes?
2. **The schema + migrations** — did you model cricket, or did you `CREATE TABLE matches` from the CSV headers?
3. **One backend file of their choosing** — is it layered, typed, tested, boring?
4. **The CI pipeline** — does it actually gate anything, or is it a green checkmark theatre?
5. **The deployed URL** — does it load, and does `/health` tell them something real?

Everything below is ordered to maximise those five.

**Hard rule for the whole build: nothing goes in the repo that you cannot explain in an interview.** No copy-pasted Terraform you never ran. No Helm chart you never applied. A reviewer who finds one piece of cargo-cult config discounts the entire repo.

---

## 1. Phase −1 — Profile the dataset before writing a line of code

Do not design the schema from the assignment PDF. Design it from the actual bytes.

```bash
unzip -l Indian_Premier_League_2022-03-26.zip
unzip Indian_Premier_League_2022-03-26.zip -d data/raw
find data/raw -type f | head -50
find data/raw -type f | wc -l
du -sh data/raw
```

The zip will almost certainly be one of two shapes. Identify which one you have on day 1:

**Shape A — Cricsheet-style** (per-match files, ball-by-ball)
- `all_matches.csv` or one `<match_id>.csv` + `<match_id>_info.csv` per match
- Ball rows: `match_id, season, start_date, venue, innings, ball, batting_team, bowling_team, striker, non_striker, bowler, runs_off_bat, extras, wides, noballs, byes, legbyes, penalty, wicket_type, player_dismissed, other_wicket_type, other_player_dismissed`
- Info rows are key-value: `info,team,...` / `info,toss_winner,...` / `info,player,<team>,<name>` / `info,registry,people,<name>,<cricsheet_id>`
- The `registry` block is gold — it gives you **stable player IDs**, which solves name-collision hell for free. Use it if present.

**Shape B — Kaggle-style** (two flat CSVs)
- `matches.csv`: `id, season, city, date, match_type, player_of_match, venue, team1, team2, toss_winner, toss_decision, winner, result, result_margin, target_runs, target_overs, super_over, method, umpire1, umpire2`
- `deliveries.csv`: `match_id, inning, over, ball, batting_team, bowling_team, batter, bowler, non_striker, batsman_runs, extra_runs, total_runs, extras_type, is_wicket, player_dismissed, dismissal_kind, fielder`
- No stable player IDs. You will have to mint them and handle aliases yourself.

Write a throwaway profiling script (`scripts/profile.ts`, not committed to `main` as production code) that prints, per file:
- row count, null rate per column, distinct-value count per column
- distinct values for every low-cardinality column (`wicket_type`, `extras_type`, `toss_decision`, `result`, `method`, `match_type`)
- distinct `venue` and `team` strings across all seasons
- min/max dates

**You are looking for the five landmines:**

| Landmine | Why it kills naive schemas |
|---|---|
| Team renames | Delhi Daredevils → Delhi Capitals, Kings XI Punjab → Punjab Kings, Royal Challengers Bangalore → Bengaluru, Deccan Chargers → (separate franchise from) Sunrisers Hyderabad, Rising Pune Supergiant**s** vs Supergiant |
| Venue name drift | "M Chinnaswamy Stadium" / "M.Chinnaswamy Stadium" / "M Chinnaswamy Stadium, Bengaluru" — same ground, 3+ strings |
| Player name drift | "S Dhawan" vs "Shikhar Dhawan"; two different players sharing an initialised name |
| Ball numbering | On a wide/no-ball, the `ball` number **repeats**. `(innings, over, ball)` is **not unique**. You need a monotonic `delivery_seq`. |
| Super overs | A 3rd (and 4th) innings that is not a real innings. Must be flagged, and **excluded from every career stat**. |

Getting these five right is the single biggest differentiator in this assignment. Most submissions get zero of them.

---

## 2. Architecture

```
                        ┌──────────────────────────────┐
   Browser ────────────▶│  Next.js 15 (App Router)     │
                        │  SSR/RSC + TanStack Query    │
                        │  typed client from OpenAPI   │
                        └───────────────┬──────────────┘
                                        │ HTTPS, JSON
                        ┌───────────────▼──────────────┐
                        │  Fastify API (Node 22, TS)   │
                        │  Zod → OpenAPI 3.1 → Swagger │
                        │  keyset pagination, RFC 9457 │
                        └───┬──────────────────────┬───┘
                            │                      │
                  ┌─────────▼────────┐   ┌─────────▼─────────┐
                  │ PostgreSQL 17    │   │ Redis (cache-aside│
                  │ OLTP + marts     │   │ + rate limit)     │
                  │ (matviews)       │   └───────────────────┘
                  └─────────▲────────┘
                            │ COPY, idempotent
                  ┌─────────┴────────┐
                  │ Ingestion CLI    │  (one-shot job / K8s Job)
                  │ raw → staging →  │
                  │ core → marts     │
                  └──────────────────┘

  Cross-cutting: OpenTelemetry traces/metrics/logs → Datadog (or OTel Collector)
```

### Stack decisions (opinionated — pick these and move on)

| Layer | Choice | Why this over the alternative |
|---|---|---|
| Runtime | **Node 22 LTS + TypeScript 5.x (strict, `noUncheckedIndexedAccess`)** | One language across the stack; shared types package between API and web is a genuine architectural win a reviewer will notice |
| HTTP | **Fastify 5** | Schema-first by design. Your validation schema *is* your OpenAPI spec — no drift possible. Express + manual swagger comments is the thing that always rots. NestJS is fine but its DI ceremony hides your actual design. |
| ORM | **Drizzle ORM + drizzle-kit** | SQL-first. You write real SQL for the analytics, and get typed results. Prisma actively fights you on window functions, CTEs and matviews — and this assignment is 70% analytical SQL. |
| DB | **PostgreSQL 17** | Required. Use it properly: CTEs, window functions, matviews, partial + covering indexes, `GENERATED` columns. |
| Cache | **Redis 7** (`ioredis`) | Cache-aside on leaderboards + rate limiting. Optional but cheap to add and shows you think about read paths. |
| Frontend | **Next.js 15 App Router + TanStack Query v5 + Tailwind + shadcn/ui** | RSC for first paint on match/player pages, TanStack Query for client-side filters and pagination. |
| Charts | **Recharts** (or **visx** if you want to show off) | Recharts is enough. Don't burn 2 days on D3. |
| Monorepo | **pnpm workspaces + Turborepo** | Remote-cacheable CI, shared `packages/contracts`. |
| Tests | **Vitest + Testcontainers + Playwright + k6** | Testcontainers-backed integration tests against a real Postgres is the single highest-signal testing choice you can make here. |
| Containers | **Docker multi-stage → distroless** | Non-root, no shell, tiny, SBOM'd. |
| CI | **GitHub Actions** | Required. |
| Cloud | **GCP** (Cloud Run + Cloud SQL + Artifact Registry) — see §15 | Fastest path to a live URL that survives a reviewer clicking it 3 weeks later. |

---

## 3. Repo layout

```
ipl-platform/
├── README.md                      # the most important file in the repo
├── docs/
│   ├── architecture.md            # + a real diagram (Excalidraw/Mermaid)
│   ├── data-model.md              # ERD + the five landmines + how you solved them
│   ├── adr/
│   │   ├── 0001-fastify-over-nest.md
│   │   ├── 0002-drizzle-over-prisma.md
│   │   ├── 0003-ball-by-ball-grain.md
│   │   ├── 0004-materialized-views-for-aggregates.md
│   │   └── 0005-keyset-pagination.md
│   └── runbook.md                 # how to reingest, how to refresh marts, what alerts mean
├── apps/
│   ├── api/                       # Fastify service
│   ├── web/                       # Next.js app
│   └── ingest/                    # CLI: load / transform / refresh / verify
├── packages/
│   ├── db/                        # Drizzle schema, migrations, seed, matview SQL
│   ├── contracts/                 # Zod schemas + generated OpenAPI + generated TS client
│   ├── domain/                    # pure cricket logic: NRR, phases, dismissal credit
│   ├── observability/             # OTel bootstrap, pino logger, metrics helpers
│   └── config/                    # env parsing (Zod), shared tsconfig/eslint
├── infra/
│   ├── terraform/                 # envs/{dev,prod}, modules/
│   ├── helm/ipl-platform/         # chart with values-{local,prod}.yaml
│   └── k8s/kind/                  # kind cluster config for CI e2e
├── .github/workflows/
│   ├── ci.yml
│   ├── cd.yml
│   ├── codeql.yml
│   └── db-migrate.yml
├── docker-compose.yml             # dev: postgres, redis, api, web, otel-collector
├── docker-compose.test.yml
├── Makefile                       # make up / make seed / make test / make e2e
└── .env.example
```

**ADRs are the highest ROI thing in this list.** Five short files (200 words each) explaining *why* you chose what you chose is what "clarity of thought" literally means in the brief. Almost nobody submits them.

---

## 4. Data model — this is where you win

### 4.1 Principles

- **Grain = one row per legal delivery.** Everything else is derived. Never store a computed aggregate you can't rebuild.
- **Three schemas:** `staging` (raw, all text, disposable) → `core` (normalised, constrained, the truth) → `marts` (matviews, denormalised for reads).
- **Surrogate keys everywhere**, with natural keys as `UNIQUE` constraints. Never key on a name string.
- **Constrain aggressively.** `CHECK`, `NOT NULL`, `FK`, enums. If a bad row can't exist, you don't need to defend against it in the API.

### 4.2 Core schema (Postgres DDL sketch)

```sql
CREATE SCHEMA core;
CREATE SCHEMA staging;
CREATE SCHEMA marts;

-- ── Enums ────────────────────────────────────────────────────────────
CREATE TYPE core.toss_decision AS ENUM ('bat','field');
CREATE TYPE core.result_kind   AS ENUM ('runs','wickets','tie','no_result','super_over');
CREATE TYPE core.extras_kind   AS ENUM ('wide','noball','bye','legbye','penalty');
CREATE TYPE core.dismissal_kind AS ENUM (
  'bowled','caught','lbw','run out','stumped','caught and bowled',
  'hit wicket','retired hurt','retired out','obstructing the field','hit the ball twice'
);
CREATE TYPE core.match_stage AS ENUM ('league','qualifier1','qualifier2','eliminator','semi_final','3rd_place','final');

-- ── Dimensions ───────────────────────────────────────────────────────
CREATE TABLE core.season (
  id          smallint PRIMARY KEY,          -- 2008..2024
  label       text NOT NULL UNIQUE,          -- '2007/08' style labels normalise here
  start_date  date,
  end_date    date
);

-- Franchise = the continuous entity. Team name = what it was called in a season.
CREATE TABLE core.franchise (
  id          serial PRIMARY KEY,
  code        text NOT NULL UNIQUE,          -- 'DC','PBKS','RCB'
  name        text NOT NULL,                 -- current canonical name
  short_name  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Every raw string ever seen maps here. THIS is how you survive renames.
CREATE TABLE core.team_alias (
  raw_name     text PRIMARY KEY,             -- 'Delhi Daredevils'
  franchise_id int NOT NULL REFERENCES core.franchise(id),
  valid_from   smallint,                     -- season id
  valid_to     smallint
);

CREATE TABLE core.venue (
  id         serial PRIMARY KEY,
  name       text NOT NULL,
  city       text,
  country    text NOT NULL DEFAULT 'India',
  UNIQUE (name, city)
);
CREATE TABLE core.venue_alias (
  raw_name text PRIMARY KEY,
  venue_id int NOT NULL REFERENCES core.venue(id)
);

CREATE TABLE core.player (
  id            serial PRIMARY KEY,
  external_id   text UNIQUE,                 -- cricsheet registry id if available
  full_name     text NOT NULL,
  display_name  text NOT NULL,
  batting_style text,
  bowling_style text
);
CREATE TABLE core.player_alias (
  raw_name  text PRIMARY KEY,                -- 'S Dhawan'
  player_id int NOT NULL REFERENCES core.player(id)
);

CREATE TABLE core.official (
  id   serial PRIMARY KEY,
  name text NOT NULL UNIQUE
);

-- ── Facts ────────────────────────────────────────────────────────────
CREATE TABLE core.match (
  id                bigint PRIMARY KEY,
  source_match_id   text NOT NULL UNIQUE,    -- traceability back to the file
  season_id         smallint NOT NULL REFERENCES core.season(id),
  match_date        date NOT NULL,
  venue_id          int NOT NULL REFERENCES core.venue(id),
  stage             core.match_stage NOT NULL DEFAULT 'league',
  home_franchise_id int NOT NULL REFERENCES core.franchise(id),
  away_franchise_id int NOT NULL REFERENCES core.franchise(id),
  toss_winner_id    int REFERENCES core.franchise(id),
  toss_decision     core.toss_decision,
  result            core.result_kind NOT NULL,
  winner_id         int REFERENCES core.franchise(id),
  result_margin     int,
  applied_dls       boolean NOT NULL DEFAULT false,
  target_runs       int,
  target_overs      numeric(4,1),
  player_of_match_id int REFERENCES core.player(id),
  CONSTRAINT match_teams_differ CHECK (home_franchise_id <> away_franchise_id),
  CONSTRAINT winner_is_a_participant CHECK (
    winner_id IS NULL OR winner_id IN (home_franchise_id, away_franchise_id)
  ),
  CONSTRAINT margin_requires_result CHECK (
    (result IN ('runs','wickets')) = (result_margin IS NOT NULL)
  )
);
CREATE INDEX ON core.match (season_id, match_date DESC);
CREATE INDEX ON core.match (venue_id);
CREATE INDEX ON core.match (home_franchise_id);
CREATE INDEX ON core.match (away_franchise_id);

CREATE TABLE core.match_official (
  match_id    bigint NOT NULL REFERENCES core.match(id) ON DELETE CASCADE,
  official_id int NOT NULL REFERENCES core.official(id),
  role        text NOT NULL DEFAULT 'umpire',
  PRIMARY KEY (match_id, official_id, role)
);

CREATE TABLE core.match_squad (
  match_id     bigint NOT NULL REFERENCES core.match(id) ON DELETE CASCADE,
  franchise_id int NOT NULL REFERENCES core.franchise(id),
  player_id    int NOT NULL REFERENCES core.player(id),
  is_captain   boolean NOT NULL DEFAULT false,
  is_keeper    boolean NOT NULL DEFAULT false,
  PRIMARY KEY (match_id, player_id)
);

CREATE TABLE core.innings (
  id                  bigserial PRIMARY KEY,
  match_id            bigint NOT NULL REFERENCES core.match(id) ON DELETE CASCADE,
  innings_no          smallint NOT NULL,
  batting_franchise_id int NOT NULL REFERENCES core.franchise(id),
  bowling_franchise_id int NOT NULL REFERENCES core.franchise(id),
  is_super_over       boolean NOT NULL DEFAULT false,
  target              int,
  UNIQUE (match_id, innings_no),
  CONSTRAINT innings_teams_differ CHECK (batting_franchise_id <> bowling_franchise_id)
);

CREATE TABLE core.delivery (
  id             bigserial PRIMARY KEY,
  innings_id     bigint NOT NULL REFERENCES core.innings(id) ON DELETE CASCADE,
  delivery_seq   int NOT NULL,        -- 1..N monotonic; THE ordering key
  over_no        smallint NOT NULL,   -- 0-indexed
  ball_in_over   smallint NOT NULL,
  striker_id     int NOT NULL REFERENCES core.player(id),
  non_striker_id int NOT NULL REFERENCES core.player(id),
  bowler_id      int NOT NULL REFERENCES core.player(id),
  runs_off_bat   smallint NOT NULL DEFAULT 0,
  extras_total   smallint NOT NULL DEFAULT 0,
  wides          smallint NOT NULL DEFAULT 0,
  noballs        smallint NOT NULL DEFAULT 0,
  byes           smallint NOT NULL DEFAULT 0,
  legbyes        smallint NOT NULL DEFAULT 0,
  penalty        smallint NOT NULL DEFAULT 0,
  runs_total     smallint GENERATED ALWAYS AS (runs_off_bat + extras_total) STORED,
  is_legal_ball  boolean  GENERATED ALWAYS AS (wides = 0 AND noballs = 0) STORED,
  UNIQUE (innings_id, delivery_seq),
  CONSTRAINT extras_sum_matches CHECK (extras_total = wides + noballs + byes + legbyes + penalty)
);
CREATE INDEX ON core.delivery (striker_id);
CREATE INDEX ON core.delivery (bowler_id);
CREATE INDEX ON core.delivery (innings_id, delivery_seq);
-- covering index for the phase-splits query
CREATE INDEX ON core.delivery (bowler_id, over_no) INCLUDE (runs_total, is_legal_ball);

-- A delivery can produce more than one dismissal (rare, but model it correctly)
CREATE TABLE core.delivery_wicket (
  id            bigserial PRIMARY KEY,
  delivery_id   bigint NOT NULL REFERENCES core.delivery(id) ON DELETE CASCADE,
  kind          core.dismissal_kind NOT NULL,
  player_out_id int NOT NULL REFERENCES core.player(id),
  UNIQUE (delivery_id, player_out_id)
);

CREATE TABLE core.wicket_fielder (
  wicket_id  bigint NOT NULL REFERENCES core.delivery_wicket(id) ON DELETE CASCADE,
  fielder_id int NOT NULL REFERENCES core.player(id),
  PRIMARY KEY (wicket_id, fielder_id)
);

-- Ingestion provenance — reviewers love this
CREATE TABLE core.ingest_run (
  id           bigserial PRIMARY KEY,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  source_label text NOT NULL,
  file_sha256  text NOT NULL,
  rows_read    bigint,
  rows_loaded  bigint,
  status       text NOT NULL DEFAULT 'running',
  error        text,
  UNIQUE (file_sha256, source_label)   -- makes reingest idempotent
);
```

### 4.3 Design points to call out in `docs/data-model.md`

- **Franchise vs team name.** One `franchise` row, many `team_alias` rows. Head-to-head across 2013→2023 then Just Works, and you can still render the era-correct name because `match` joins through the alias when displaying.
- **`delivery_seq`.** Explains why `(over, ball)` is not unique and how you fixed it. This single paragraph signals more domain care than any feature.
- **Generated columns.** `runs_total` and `is_legal_ball` are computed in the database, so no application code can ever write an inconsistent row.
- **`is_super_over`.** Every mart filters it out. Say so explicitly.
- **Why not partition `delivery`?** ~260k rows total. Partitioning here would be resume-driven development. Note that you considered it and rejected it, with the threshold at which you'd revisit (~50M rows / when a single season's scan exceeds your p99 budget). *Knowing when not to use a technique is a stronger signal than using it.*

---

## 5. Ingestion pipeline

`apps/ingest` is a CLI, not a script. Commands:

```
ingest load     --source ./data/raw --run-label bootstrap
ingest verify   --run-id <id>
ingest refresh  --marts all
ingest resolve  --entities teams,venues,players   # interactive alias review
```

### Flow

```
 zip → sha256 per file → skip if already in ingest_run (idempotency)
     → stream-parse CSV (csv-parse) in batches of 5k
     → COPY into staging.* (all TEXT columns, zero constraints)
     → entity resolution pass: populate franchise/venue/player + aliases
     → transactional transform staging → core (single tx per match)
     → data-quality assertions
     → REFRESH MATERIALIZED VIEW CONCURRENTLY on marts
     → write ingest_run row (rows_read, rows_loaded, status)
```

### Implementation notes

- Use **`pg-copy-streams`** for the staging load, not row-by-row inserts. 260k rows should land in **under 5 seconds**. Put that number in the README — reviewers notice benchmarks.
- **Entity resolution:** normalise (`lower`, strip punctuation, collapse whitespace, strip trailing city), then exact match against `*_alias`. Unmatched values go to a `staging.unresolved_entity` table and the run **fails loudly** rather than silently inserting a duplicate franchise. Seed the known alias map as a committed data file (`packages/db/seed/aliases.json`) — that file is a genuine artifact of domain work.
- **Idempotency:** re-running `ingest load` on the same zip must be a no-op. Prove it with a test that runs it twice and asserts identical row counts.
- **Transactional per match** so a bad match rolls back alone.

### Data-quality assertions (run after every ingest, fail the pipeline on breach)

```sql
-- every innings has 6 legal balls per completed over
-- no innings exceeds 20 completed overs (excluding super overs)
-- sum(delivery.runs_total) per innings == innings total from source
-- every match has >= 2 innings
-- no player is striker and bowler on the same delivery
-- match.winner_id is always one of the two participants
-- no orphan aliases
```

Ship these as a `packages/db/checks/*.sql` set executed by `ingest verify`. This is your **data contract**, and it's the kind of thing that separates a data platform from a CSV importer.

---

## 6. Analytics layer (marts)

Materialized views, refreshed `CONCURRENTLY` after ingest. Each gets a `UNIQUE` index (required for concurrent refresh).

| Matview | Serves |
|---|---|
| `marts.batting_innings` | per-player-per-match: runs, balls, 4s, 6s, SR, dismissal |
| `marts.bowling_innings` | per-player-per-match: overs, runs, wickets, econ, dots, maidens |
| `marts.batting_career` | career + per-season rollups, with `min_balls` guardrails |
| `marts.bowling_career` | same for bowling |
| `marts.phase_splits` | powerplay (ov 0–5) / middle (6–14) / death (15–19) for bat + bowl |
| `marts.partnership` | wicket-by-wicket partnerships per innings |
| `marts.head_to_head` | franchise × franchise: P/W/L/NR, last 5 |
| `marts.venue_profile` | avg 1st-inns score, chase win %, toss-decision win % |
| `marts.points_table` | per season: P, W, L, NR, pts, **NRR**, position |

### Net Run Rate — the flex

NRR is where most candidates hand-wave. The rule that trips people: **if a team is all out, you count their full over quota (20), not the overs actually faced.** Implement it correctly in `packages/domain/nrr.ts` + SQL, and unit-test it against a real published points table.

```sql
-- sketch
WITH inns AS (
  SELECT i.match_id, i.batting_franchise_id AS team, i.bowling_franchise_id AS opp,
         SUM(d.runs_total) AS runs,
         -- all out => full quota
         CASE WHEN COUNT(*) FILTER (WHERE w.id IS NOT NULL) >= 10
              THEN 20.0
              ELSE COUNT(*) FILTER (WHERE d.is_legal_ball) / 6.0
         END AS overs
  FROM core.innings i
  JOIN core.delivery d ON d.innings_id = i.id
  LEFT JOIN core.delivery_wicket w ON w.delivery_id = d.id
  WHERE NOT i.is_super_over
  GROUP BY 1,2,3
)
SELECT team,
       SUM(runs) FILTER (WHERE side='for')     / NULLIF(SUM(overs) FILTER (WHERE side='for'),0)
     - SUM(runs) FILTER (WHERE side='against') / NULLIF(SUM(overs) FILTER (WHERE side='against'),0)
       AS nrr
FROM ...
```

Put a note in the README: *"Points table NRR is validated against published 2016 and 2019 standings — see `packages/domain/__tests__/nrr.test.ts`."* That one sentence is worth more than three extra pages.

**Refresh strategy:** after ingest (one-shot), plus a `POST /internal/refresh` endpoint guarded by a service token for on-demand. Document that in a real streaming system this would be an incremental/CDC pipeline; here, batch refresh is correct for the data's cadence. Say why.

---

## 7. Backend API

### 7.1 Layering

```
routes/       → HTTP concerns only: schema binding, status codes
  ↓
services/     → orchestration, caching, auth checks
  ↓
repositories/ → Drizzle queries + raw SQL. Only layer that knows about the DB.
  ↓
packages/domain → pure functions, zero I/O, 100% unit tested
```

Enforce it with `eslint-plugin-boundaries` so a route can never import a repository directly. Automated architecture enforcement in the linter is a strong senior signal.

### 7.2 Endpoints

```
GET  /health/live                 # process is up
GET  /health/ready                # DB + Redis reachable, migrations current, marts fresh
GET  /metrics                     # prometheus
GET  /docs                        # Swagger UI
GET  /openapi.json

GET  /v1/seasons
GET  /v1/seasons/{year}/points-table
GET  /v1/seasons/{year}/leaders?metric=runs|wickets|sr|economy&limit=

GET  /v1/teams
GET  /v1/teams/{id}
GET  /v1/teams/{id}/season-summary
GET  /v1/teams/{a}/head-to-head/{b}

GET  /v1/players?q=&season=&cursor=&limit=
GET  /v1/players/{id}
GET  /v1/players/{id}/batting?season=&venue=&opponent=&phase=
GET  /v1/players/{id}/bowling?...
GET  /v1/players/{id}/form?last=10

GET  /v1/matches?season=&team=&venue=&from=&to=&stage=&cursor=&limit=
GET  /v1/matches/{id}                       # full scorecard, both innings
GET  /v1/matches/{id}/deliveries?innings=&cursor=
GET  /v1/matches/{id}/worm                  # cumulative runs by ball
GET  /v1/matches/{id}/manhattan             # runs+wickets per over
GET  /v1/matches/{id}/partnerships

GET  /v1/venues
GET  /v1/venues/{id}/profile

GET  /v1/analytics/phase-splits?season=&team=
GET  /v1/analytics/compare?playerA=&playerB=&metric=

POST /internal/refresh-marts                # service-token guarded
```

### 7.3 Non-negotiable API mechanics

**Keyset (cursor) pagination as the default.** `OFFSET 40000` is a table scan; a reviewer will clock it instantly.

```ts
// cursor = base64({ lastSeq: number, lastId: number }), opaque to the client
{ "data": [...], "page": { "nextCursor": "eyJ...", "limit": 50, "hasMore": true } }
```
Offer `?page=` offset mode only on small collections (seasons, venues) and say why in the docs.

**RFC 9457 `application/problem+json` for every error.** One error shape, forever:

```json
{
  "type": "https://ipl.example.com/errors/validation-failed",
  "title": "Validation failed",
  "status": 422,
  "detail": "limit must be <= 100",
  "instance": "/v1/matches",
  "traceId": "0af7651916cd43dd8448eb211c80319c",
  "errors": [{ "path": "query.limit", "message": "Number must be less than or equal to 100" }]
}
```

**Correlation.** `x-request-id` in (or generated), echoed out, attached to every log line and the OTel span. `traceId` in the error body so a user can hand you a string and you find the exact trace.

**Caching.** Strong `ETag` on aggregate endpoints + `Cache-Control: public, max-age=60, stale-while-revalidate=300`. Redis cache-aside with a version-stamped key namespace (`v{martVersion}:leaders:2016:runs`) so a mart refresh invalidates everything atomically by bumping one integer. That invalidation trick is a nice thing to have an answer for.

**Rate limiting.** `@fastify/rate-limit` with Redis store, `RateLimit-*` headers.

**Graceful shutdown.** `SIGTERM` → stop accepting → drain in-flight (with timeout) → close pool → exit 0. Required for a clean K8s/Cloud Run rollout, and almost always missing in submissions.

**Timeouts everywhere.** `statement_timeout` on the pool, server `connectionTimeout`, an outbound timeout budget. Unbounded queries are how prod dies.

### 7.4 OpenAPI without drift

Define request/response schemas **once** in `packages/contracts` with Zod, then:

```ts
// packages/contracts/src/matches.ts
export const MatchQuery = z.object({
  season: z.coerce.number().int().min(2008).max(2030).optional(),
  team:   z.string().max(64).optional(),
  limit:  z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
}).openapi('MatchQuery');
```

```ts
// apps/api/src/routes/matches.ts
app.withTypeProvider<ZodTypeProvider>().get('/v1/matches', {
  schema: {
    tags: ['matches'],
    querystring: MatchQuery,
    response: { 200: MatchListResponse, 422: Problem },
  },
}, handler);
```

Then:
- `@fastify/swagger` emits **OpenAPI 3.1** at `/openapi.json`, `@fastify/swagger-ui` serves `/docs`.
- A CI job dumps the spec, runs **Spectral** lint on it, and **fails the build if the committed `openapi.json` differs from the generated one.**
- `openapi-typescript` generates the frontend's types; `openapi-fetch` gives a fully-typed client. **The frontend cannot compile against an API route that doesn't exist.**

That last bullet — a contract break in the API failing the *frontend's* type-check in CI — is a genuinely senior piece of design and is worth calling out explicitly in the README.

---

## 8. Frontend

### Pages

| Route | Content |
|---|---|
| `/` | League overview: seasons timeline, all-time leaders, quick stats |
| `/seasons/[year]` | Points table (with NRR), season leaders, matches list |
| `/matches` | Filterable, paginated table (season / team / venue / date range) |
| `/matches/[id]` | Scorecard (both innings), **worm chart**, **manhattan chart**, partnership bars, ball-by-ball drawer |
| `/teams` → `/teams/[id]` | Season-by-season trend, H2H matrix heatmap, home/away splits |
| `/players` → `/players/[id]` | Career arc, phase splits radar, vs-opponent breakdown, venue splits, form (last 10) |
| `/players/compare` | Two-player side-by-side |
| `/venues/[id]` | Toss impact, avg 1st-innings score by season, chase success rate |

### Engineering points

- **RSC for the first paint** on `/matches/[id]` and `/players/[id]` (fetch server-side, stream with `<Suspense>`), TanStack Query for anything filter-driven.
- **Loading / empty / error states are explicitly graded.** Build them as three shared components (`<Skeleton>`, `<EmptyState>`, `<ErrorState>` with retry) and use them everywhere. Add an error boundary per route segment. Force yourself to see them: add `?__state=empty|error` dev-only overrides, and screenshot them in the README.
- **URL is the state.** Every filter lives in the query string (`nuqs` or plain `useSearchParams`). Shareable, back-button-correct, and it means your loading states are actually exercised.
- **Virtualise** the ball-by-ball list (`@tanstack/react-virtual`) — 260 rows per innings is fine, but the deliveries endpoint can return more.
- **Accessibility:** every chart gets an accessible `<table>` fallback behind a "View as table" toggle. Cheap, and it reads as maturity.
- **Design:** pick a restrained palette, one type scale, consistent spacing. A clean two-colour dashboard beats a rainbow of default Recharts colours. Team colours only where they carry meaning.

---

## 9. Observability

`packages/observability` bootstraps once, imported first in both apps.

- **Traces:** OpenTelemetry auto-instrumentation (http, fastify, pg, ioredis) → OTLP → Datadog Agent (or an OTel Collector in compose). Add manual spans around ingest phases.
- **Logs:** `pino`, JSON, with `trace_id`/`span_id`/`request_id` injected. **Redact** anything sensitive by config, not by hoping.
- **Metrics (RED + USE):** request rate / errors / duration histogram by route; DB pool in-use vs idle; cache hit ratio; ingest rows/sec; mart staleness in seconds.
- **`/health/ready` returns substance**, not `{"ok":true}`:

```json
{
  "status": "ok",
  "version": "1.4.2",
  "commit": "a1b2c3d",
  "uptimeSeconds": 8241,
  "checks": {
    "database":       { "status": "ok", "latencyMs": 3 },
    "redis":          { "status": "ok", "latencyMs": 1 },
    "migrations":     { "status": "ok", "applied": 14, "pending": 0 },
    "martFreshness":  { "status": "ok", "lastRefresh": "2026-08-27T04:00:00Z", "ageSeconds": 3600 }
  }
}
```

Liveness must **not** check dependencies (or a DB blip restarts every pod). Readiness must. Explain that distinction in the runbook — it's a small thing that experienced reviewers specifically look for.

- **Datadog dashboard** (stretch goal, worth doing): p50/p95/p99 latency by route, error rate, DB pool saturation, mart freshness. Two monitors: error rate > 2% for 5m, and mart staleness > 24h. Screenshot both in the README.

---

## 10. Testing

| Layer | Tool | What |
|---|---|---|
| Unit | Vitest | `packages/domain`: NRR, phase classification, strike rate/economy edge cases (0 balls faced, all-out, super over), dismissal credit. Aim 100% here — it's pure functions. |
| Integration | Vitest + **Testcontainers** | Spin real Postgres, run migrations, load a **10-match golden fixture**, hit routes via `app.inject()`. Assert JSON shape *and* numbers. |
| Contract | `openapi-response-validator` | Every integration response validated against the generated spec. Guarantees docs match reality. |
| Ingest | Vitest | Idempotency (run twice → same counts), malformed row rejection, alias resolution, all DQ assertions pass. |
| E2E | Playwright | 4 flows: load dashboard → filter matches → open match detail (chart renders) → player page. Plus one a11y pass with `@axe-core/playwright`. |
| Load | k6 | 100 VUs on `/v1/matches` and `/v1/seasons/2016/points-table`. Record p95. Put the number in the README. |

**The golden fixture is important.** A committed 10-match subset with hand-verified expected outputs (`fixtures/expected/match-335982-scorecard.json`) means your tests assert *correct cricket*, not just "returns 200". That's the difference between tests and test theatre.

Coverage gate at 80% on `apps/api` and `packages/domain`, enforced in CI. Don't gate the frontend on coverage — gate it on Playwright.

---

## 11. Containerization

### API Dockerfile (multi-stage → distroless)

```dockerfile
# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/*/package.json packages/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @ipl/api build && \
    pnpm --filter @ipl/api deploy --legacy --prod /out

FROM gcr.io/distroless/nodejs22-debian12:nonroot AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=nonroot:nonroot /out ./
USER nonroot
EXPOSE 3000
CMD ["dist/server.js"]
```

Points to hit:
- `--frozen-lockfile`, always.
- **Distroless + nonroot**: no shell, no package manager, minimal CVE surface. Have an answer for "how do you debug it then?" → ephemeral debug container / `:debug` variant.
- Order layers by change frequency (lockfile → deps → source).
- **`.dockerignore`** — `node_modules`, `.git`, `data/raw`, `.env`. Forgetting this is the classic 2GB-image mistake.
- `HEALTHCHECK` in compose (distroless has no shell, so use a Node one-liner or rely on the orchestrator's HTTP probe).
- Next.js uses `output: 'standalone'`.
- Build `linux/amd64` + `linux/arm64` with buildx if you're on an M-series Mac.
- Pin base images by digest in the CD workflow.

### docker-compose (dev)

```yaml
services:
  postgres:
    image: postgres:17-alpine
    healthcheck: { test: ["CMD-SHELL","pg_isready -U ipl"], interval: 5s, retries: 10 }
  redis:
    image: redis:7-alpine
  migrate:
    build: { context: ., dockerfile: apps/ingest/Dockerfile }
    command: ["migrate","up"]
    depends_on: { postgres: { condition: service_healthy } }
  api:
    depends_on: { migrate: { condition: service_completed_successfully } }
  web:
    depends_on: { api: { condition: service_healthy } }
  otel-collector:
    image: otel/opentelemetry-collector-contrib:latest
```

`depends_on: condition: service_healthy` and a `service_completed_successfully` migration gate — that's what makes `docker compose up` actually work first try on the reviewer's machine. **Test this on a clean clone before you submit.** `git clone && cp .env.example .env && make up` must produce a working app with data loaded. If it doesn't, nothing else in the repo matters.

---

## 12. CI/CD

### `ci.yml` (on PR + push)

```
setup      → pnpm install (cached), turbo remote cache
lint       → eslint + prettier --check + tsc --noEmit  [parallel]
test:unit  → vitest run --coverage                     [parallel]
test:integ → Testcontainers Postgres + migrations + API tests
contract   → generate openapi.json, diff vs committed, spectral lint  ← fails on drift
build      → docker buildx bake, GHA cache, push to GHCR :sha
security   → trivy image (fail on HIGH/CRITICAL), syft SBOM, gitleaks
e2e        → docker compose up + playwright
```

Details that matter:
- **Concurrency group** cancelling superseded runs.
- **Least-privilege `permissions:`** per job (`contents: read` by default).
- **Pin actions by SHA**, not `@v4`. Supply-chain awareness.
- Publish coverage + Playwright traces as artifacts.
- **Attach the SBOM and sign images with cosign** (keyless OIDC). Two extra lines, disproportionate signal.

### `cd.yml` (on push to `main`, environment-gated)

```
1. reuse the :sha image built in CI (never rebuild — you'd deploy untested bytes)
2. authenticate to GCP via Workload Identity Federation (NO long-lived JSON key)
3. run migrations as a one-shot Cloud Run Job — gated, reversible
4. deploy API with traffic split 10% → smoke test /health/ready → promote to 100%
5. deploy web
6. tag :latest, create GitHub Release with changelog
```

**Workload Identity Federation instead of a service-account key is a specific, checkable thing that separates people who've done this in production from people who've read a tutorial.** Call it out in the README.

Migrations run as a **separate gated job**, expand-then-contract style (add column → backfill → switch reads → drop later). Never destructive in one deploy. One paragraph on this in `docs/runbook.md`.

---

## 13. Infrastructure as Code + Kubernetes

### Terraform (`infra/terraform`)

```
modules/
  network/        # VPC, subnets, VPC connector
  database/       # Cloud SQL Postgres 17, private IP, automated backups, PITR
  registry/       # Artifact Registry
  runtime/        # Cloud Run services + IAM
  observability/  # log sinks, uptime checks, alert policies
envs/
  dev/  prod/
```

- **Remote state** in GCS with locking. Never local state.
- `terraform fmt -check`, `validate`, **`tflint`**, **`tfsec`/`checkov`** in CI.
- **`terraform plan` posted as a PR comment**; `apply` only on merge, manual-approval environment.
- Secrets from **Secret Manager**, referenced — never `variable "db_password"` with a default.

### Helm (`infra/helm/ipl-platform`)

Templates: `Deployment` (api, web), `Service`, `Ingress`, `ConfigMap`, `ExternalSecret`, `HPA`, `PDB`, `NetworkPolicy`, `ServiceAccount`, and a migration `Job` with a `pre-upgrade` hook.

Non-negotiables inside the chart:
- resource `requests` **and** `limits` (and a note on why CPU limits are often a mistake — throttling)
- `readinessProbe` → `/health/ready`, `livenessProbe` → `/health/live`, plus a `startupProbe`
- `securityContext`: `runAsNonRoot`, `readOnlyRootFilesystem`, `allowPrivilegeEscalation: false`, `capabilities: drop: [ALL]`
- `topologySpreadConstraints` + `PodDisruptionBudget`
- `terminationGracePeriodSeconds` aligned with your graceful-shutdown drain timeout
- config from `ConfigMap`, secrets from `ExternalSecrets` — **nothing sensitive in `values.yaml`**
- checksum annotation on the ConfigMap so config changes trigger a rollout

**Prove the chart works.** CI job: spin up `kind`, `helm install`, wait for rollout, curl `/health/ready`, run smoke tests, tear down. Plus `helm lint` + `kubeconform` + `helm template | kubectl apply --dry-run=server`.

A Helm chart proven by a green `kind` job in CI is more credible than a live cluster you can't afford to keep running. An unvalidated chart is worse than no chart.

---

## 14. Deployment

Two viable paths. **Pick based on budget, then be transparent about the choice.**

**Path A — Cloud Run (recommended)**
- API + web on Cloud Run (scale-to-zero, generous free tier, HTTPS + custom domain free)
- Postgres on **Neon** free tier (or Cloud SQL `db-f1-micro` if you have credits)
- Artifact Registry for images
- Cost: ~$0–5/month. **Survives a reviewer clicking the link a month later**, which is the actual requirement.

**Path B — GKE Autopilot**
- Real cluster, your Helm chart actually running, Ingress + managed cert
- Cost: ~$70+/month. Only if you have credits and can leave it up through the hiring process.

**Do this either way:** deploy on Path A for the live URL, ship the Helm chart validated on `kind` in CI, and write in the README:

> *Live deployment runs on Cloud Run for cost reasons (scale-to-zero, ~$0/mo). The Kubernetes manifests and Helm chart are validated on every commit via a kind-based integration job (`.github/workflows/ci.yml#e2e-k8s`) — see the passing run and the recorded demo in `docs/k8s-demo.md`. On GKE Autopilot the same chart deploys with `helm upgrade --install -f values-prod.yaml`.*

That paragraph is honest, shows judgement about cost, and pre-empts the obvious question. **A dead link is worse than no link** — set a calendar reminder to check it weekly.

Also: seed the deployed database. An empty production app is an instant fail. Run the ingest as a Cloud Run Job post-deploy.

---

## 15. Security

Cheap to do, and it's your actual domain — lean into it.

- Env validated at boot with Zod; **process exits if config is invalid.** Fail fast, never start half-configured.
- `helmet` equivalent (`@fastify/helmet`), strict CSP on the web app, HSTS.
- CORS allowlist from config — never `origin: '*'`.
- Body size limits, `@fastify/rate-limit`, request timeouts.
- **Parameterised queries only.** Where you use raw SQL, use Drizzle's `sql` tagged template (it parameterises). Add an ESLint rule banning string-concatenated SQL.
- Secrets: Secret Manager / GH Actions secrets. `gitleaks` in CI. `.env` in `.gitignore` and `.dockerignore`.
- Dependencies: **Dependabot** + `pnpm audit --audit-level=high` in CI. Lockfile committed.
- Containers: distroless, nonroot, read-only rootfs, `cap_drop: ALL`, Trivy gate.
- `SECURITY.md` with a disclosure policy.
- CodeQL workflow enabled.

One short "Threat model" section in `docs/architecture.md` — what's exposed, what's trusted, what you'd add for a real multi-tenant deployment (authn/authz, per-tenant rate limits, audit log). Showing you know what's *missing* and why it's out of scope beats pretending it's complete.

---

## 16. The README (write it first, refine it last)

Structure:

1. **One-paragraph what-and-why** + live URLs (app, Swagger, health) + a screenshot
2. **Architecture diagram** (Mermaid, renders inline on GitHub)
3. **Quickstart** — must be exactly three commands
4. **Data model** — ERD + the five landmines and how each was solved
5. **API** — endpoint table + link to Swagger + the pagination/error conventions
6. **Testing** — what's covered, how to run, coverage badge
7. **CI/CD** — pipeline diagram, what gates what
8. **Deployment** — the honest Cloud-Run-vs-K8s paragraph from §14
9. **Performance** — ingest throughput, p95 latencies from k6, biggest query plan before/after indexing
10. **Trade-offs & what I'd do next** ← *read most carefully of all*
11. **ADR index**

Section 10 is where you demonstrate seniority. Be specific:

> - Did not partition `core.delivery` (~260k rows). At ~50M rows I'd partition by `season_id`.
> - Marts refresh in batch after ingest. With live match feeds I'd move to incremental refresh or a CDC → streaming aggregate path.
> - No authn — the dataset is public and read-only. Adding it means OIDC + per-key rate limits; the middleware seams are already in place at `apps/api/src/plugins/`.
> - Redis is a nice-to-have at this data size; I added it to exercise the invalidation design, and it earns its place if traffic grows.
> - Player entity resolution is alias-table based. At larger scale I'd use fuzzy matching (`pg_trgm`) with a human review queue.

Add a Mermaid ERD and pipeline diagram — they render natively on GitHub and make the README feel authored rather than generated.

---

## 17. Execution schedule (10 working days)

| Day | Deliverable | Definition of done |
|---|---|---|
| **1** | Dataset profiled; monorepo scaffolded; compose (pg + redis) up; CI skeleton green | `make up` works; a lint job passes on an empty repo |
| **2** | Full schema + migrations; alias seed data; ERD | `pnpm db:migrate` from empty → full schema, twice, cleanly |
| **3** | Ingestion end-to-end; DQ assertions; idempotency test | Full dataset loads in < 30s; second run is a no-op |
| **4** | Marts + NRR; validated against published standings | `points-table` matches 2016 + 2019 official tables exactly |
| **5** | API: health, seasons, teams, matches, players; Zod→OpenAPI; Swagger live | `/docs` renders; contract-drift CI job green |
| **6** | API: analytics endpoints, caching, pagination, errors, rate limits; integration tests | Coverage ≥ 80% on api + domain |
| **7** | Frontend: layout, dashboard, matches list + detail with charts | Loading/empty/error states verifiable via `?__state=` |
| **8** | Frontend: players, teams, venues, compare; a11y pass | Playwright green; axe reports no critical violations |
| **9** | Dockerfiles → distroless; full CI/CD; Trivy + SBOM + cosign; deploy live; seed prod | Live URL loads with real data; `/health/ready` returns all-ok |
| **10** | Terraform + Helm + kind CI job; Datadog dashboard; README + ADRs + runbook; k6 numbers | Clean-clone test passes; every link in the README works |

**Cut in this order if you run short:** Datadog → Terraform → Redis → compare page → k6. **Never cut:** README, ADRs, tests, migrations, Swagger, working deploy.

---

## 18. Anti-patterns that will sink the submission

- `SELECT *` reaching the API response. Explicit projections only.
- Business logic in route handlers.
- `any` anywhere in TypeScript. Turn on `strict` + `noUncheckedIndexedAccess` on day 1, not day 9 — retrofitting is miserable.
- Migrations that aren't reversible, or hand-edited after being applied.
- `.env` committed. Instant credibility loss for a security-adjacent candidate.
- A `k8s/` folder of YAML you never applied.
- Terraform without remote state.
- N+1 queries building the scorecard. One query, or a `DataLoader`-style batch.
- `console.log`. Structured logging or nothing.
- A README that's the framework's default scaffold text.
- 15 endpoints where 8 are broken. **Eight excellent endpoints beat twenty mediocre ones** — the brief says so explicitly.
- Charts with no empty state that render a blank box when a filter matches nothing.
- A dead deployed URL.

---

## 19. First three commands

```bash
mkdir ipl-platform && cd ipl-platform && git init
pnpm init && pnpm add -D turbo typescript @types/node vitest
mkdir -p apps/{api,web,ingest} packages/{db,contracts,domain,observability,config} \
         infra/{terraform,helm,k8s} docs/adr .github/workflows
```

Then: unzip the dataset and profile it. Everything else follows from what's actually in those files.

---

**The whole plan in one line:** model cricket correctly, prove it with tests against known-correct results, make the contract generate itself, gate the pipeline on things that can actually fail, deploy something that stays up, and write down why you chose each of those.