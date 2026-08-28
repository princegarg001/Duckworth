-- Reconciliation against the vendor's own numbers.
--
-- These are the checks that matter. Everything the API serves is derived from
-- `core.delivery`; the `quality.source_*` tables hold what the data provider
-- claims. If our derivation is wrong in any way — a mis-scoped extra, a
-- miscounted ball, a wicket credited to the wrong bowler — these fail.

-- name: innings_runs_reconcile
-- description: Runs summed from deliveries must equal the published innings total.
select d.innings_id,
       sum(d.total_runs) as derived_runs,
       t.runs           as source_runs
from core.delivery d
join quality.source_innings_total t on t.innings_id = d.innings_id
group by d.innings_id, t.runs
having sum(d.total_runs) <> t.runs;

-- name: innings_wickets_reconcile
-- description: Wickets lost must equal the published figure.
select t.innings_id,
       coalesce(w.wickets, 0) as derived_wickets,
       t.wickets              as source_wickets
from quality.source_innings_total t
left join (
  select innings_id, count(*) as wickets
  from core.dismissal
  where counts_as_wicket_lost
  group by innings_id
) w on w.innings_id = t.innings_id
where coalesce(w.wickets, 0) <> t.wickets;

-- name: batting_runs_reconcile
-- description: Per-batter runs derived from deliveries must match the scorecard.
select d.innings_id, d.striker_id as player_id,
       sum(d.bat_runs) as derived_runs,
       c.runs          as source_runs
from core.delivery d
join quality.source_batting_card c
  on c.innings_id = d.innings_id and c.player_id = d.striker_id
group by d.innings_id, d.striker_id, c.runs
having sum(d.bat_runs) <> c.runs;

-- name: batting_balls_faced_reconcile
-- description: Balls faced excludes wides but includes no-balls.
select d.innings_id, d.striker_id as player_id,
       count(*) filter (where d.counts_as_ball_faced) as derived_balls,
       c.balls_faced                                  as source_balls
from core.delivery d
join quality.source_batting_card c
  on c.innings_id = d.innings_id and c.player_id = d.striker_id
group by d.innings_id, d.striker_id, c.balls_faced
having count(*) filter (where d.counts_as_ball_faced) <> c.balls_faced;

-- name: batting_boundaries_reconcile
-- description: Fours and sixes must match the scorecard.
select d.innings_id, d.striker_id as player_id,
       count(*) filter (where d.is_four) as derived_fours,
       c.fours                           as source_fours,
       count(*) filter (where d.is_six)  as derived_sixes,
       c.sixes                           as source_sixes
from core.delivery d
join quality.source_batting_card c
  on c.innings_id = d.innings_id and c.player_id = d.striker_id
group by d.innings_id, d.striker_id, c.fours, c.sixes
having count(*) filter (where d.is_four) <> c.fours
    or count(*) filter (where d.is_six)  <> c.sixes;

-- name: bowling_balls_reconcile
-- description: Legal balls bowled must match the scorecard's overs figure.
select d.innings_id, d.bowler_id as player_id,
       count(*) filter (where d.is_legal_ball) as derived_balls,
       c.balls_bowled                          as source_balls
from core.delivery d
join quality.source_bowling_card c
  on c.innings_id = d.innings_id and c.player_id = d.bowler_id
group by d.innings_id, d.bowler_id, c.balls_bowled
having count(*) filter (where d.is_legal_ball) <> c.balls_bowled;

-- name: bowling_runs_conceded_reconcile
-- description: Byes and leg-byes are not charged to the bowler; wides and no-balls are.
select d.innings_id, d.bowler_id as player_id,
       sum(d.bat_runs + d.wide_runs + d.noball_runs) as derived_runs,
       c.runs_conceded                               as source_runs
from core.delivery d
join quality.source_bowling_card c
  on c.innings_id = d.innings_id and c.player_id = d.bowler_id
group by d.innings_id, d.bowler_id, c.runs_conceded
having sum(d.bat_runs + d.wide_runs + d.noball_runs) <> c.runs_conceded;

-- name: bowling_wickets_reconcile
-- description: Bowler wickets exclude run-outs and retirements.
select c.innings_id, c.player_id,
       coalesce(w.wickets, 0) as derived_wickets,
       c.wickets              as source_wickets
from quality.source_bowling_card c
left join (
  select innings_id, bowler_id, count(*) as wickets
  from core.dismissal
  where credits_bowler
  group by innings_id, bowler_id
) w on w.innings_id = c.innings_id and w.bowler_id = c.player_id
where coalesce(w.wickets, 0) <> c.wickets;

-- name: innings_extras_reconcile
-- description: Extras derived from deliveries must equal the vendor's stated extras total.
select e.innings_id, e.total as derived_total, t.extras_total as source_total
from core.innings_extras e
join quality.source_innings_total t on t.innings_id = e.innings_id
where e.total <> t.extras_total;

-- name: vendor_extras_components_self_consistent
-- description: The vendor's own extras components should sum to its own stated total.
-- severity: warn
select innings_id,
       (byes + legbyes + wides + noballs + penalty) as component_sum,
       extras_total                                 as stated_total
from quality.source_innings_total
where (byes + legbyes + wides + noballs + penalty) <> extras_total;

-- name: points_table_matches_published_standings
-- description: Our derived points table must equal the official league table exactly.
select p.team_id,
       p.points as derived_points, s.points as source_points,
       p.won    as derived_won,    s.won    as source_won,
       p.lost   as derived_lost,   s.lost   as source_lost,
       p.net_run_rate as derived_nrr, s.net_run_rate as source_nrr,
       p.runs_for as derived_runs_for, s.runs_for as source_runs_for,
       p.balls_for as derived_balls_for, s.balls_for as source_balls_for
from marts.points_table p
join quality.source_standing s
  on s.season_id = p.season_id and s.team_id = p.team_id
where p.points <> s.points
   or p.won    <> s.won
   or p.lost   <> s.lost
   or p.runs_for <> s.runs_for
   or p.balls_for <> s.balls_for
   or p.runs_against <> s.runs_against
   or p.balls_against <> s.balls_against
   or round(p.net_run_rate, 3) <> round(s.net_run_rate, 3);
