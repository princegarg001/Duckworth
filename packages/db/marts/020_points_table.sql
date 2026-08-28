-- The points table.
--
-- This view is the single most load-bearing piece of SQL in the platform,
-- because `points_table_matches_published_standings` asserts it equals the
-- official IPL 2022 table exactly — points, wins, losses, run and ball
-- subtotals, and NRR to three decimals.
--
-- Three rules make that work, and all three are easy to miss:
--
--   1. LEAGUE STAGE ONLY. The four playoff fixtures are excluded. Including
--      them changes the NRR of all four qualifiers and reconciles with nothing.
--   2. ALL OUT => FULL QUOTA. A side dismissed inside its 20 overs is charged
--      20 overs anyway. Without this every figure is wrong; with it, all ten
--      teams match to the third decimal.
--   3. RETIRED HURT IS NOT A WICKET. It must not push a side to ten down and
--      trigger rule 2 spuriously.

drop materialized view if exists marts.points_table cascade;
create materialized view marts.points_table as
with league_innings as (
    select
        i.id                as innings_id,
        i.match_id,
        m.season_id,
        i.batting_team_id,
        i.bowling_team_id,
        i.allotted_overs,
        coalesce(sum(d.total_runs), 0)                      as runs,
        count(*) filter (where d.is_legal_ball)             as legal_balls,
        coalesce(w.wickets, 0)                              as wickets_lost
    from core.innings i
    join core.match m on m.id = i.match_id
    left join core.delivery d on d.innings_id = i.id
    left join (
        select innings_id, count(*) as wickets
        from core.dismissal
        where counts_as_wicket_lost          -- excludes retired hurt (rule 3)
        group by innings_id
    ) w on w.innings_id = i.id
    where m.stage = 'league'                 -- rule 1
      and not i.is_super_over
    group by i.id, i.match_id, m.season_id, i.batting_team_id, i.bowling_team_id,
             i.allotted_overs, w.wickets
),
chargeable as (
    select
        season_id,
        batting_team_id,
        bowling_team_id,
        runs,
        -- rule 2
        case when wickets_lost >= 10 then allotted_overs * 6 else legal_balls end
            as balls
    from league_innings
),
for_side as (
    select season_id, batting_team_id as team_id,
           sum(runs) as runs_for, sum(balls) as balls_for
    from chargeable group by season_id, batting_team_id
),
against_side as (
    select season_id, bowling_team_id as team_id,
           sum(runs) as runs_against, sum(balls) as balls_against
    from chargeable group by season_id, bowling_team_id
),
results as (
    select m.season_id, t.team_id, t.opponent_id,
           case
             when m.winner_id is null            then 'no_result'
             when m.winner_id = t.team_id        then 'win'
             else 'loss'
           end as outcome
    from core.match m
    cross join lateral (
        values (m.team_a_id, m.team_b_id), (m.team_b_id, m.team_a_id)
    ) as t(team_id, opponent_id)
    where m.stage = 'league'
),
tallies as (
    select season_id, team_id,
           count(*)::int                                          as played,
           count(*) filter (where outcome = 'win')::int            as won,
           count(*) filter (where outcome = 'loss')::int           as lost,
           count(*) filter (where outcome = 'no_result')::int      as no_result,
           (2 * count(*) filter (where outcome = 'win')
              + count(*) filter (where outcome = 'no_result'))::int as points
    from results
    group by season_id, team_id
),
head_to_head_wins as (
    select season_id, team_id, opponent_id, count(*)::int as wins
    from results where outcome = 'win'
    group by season_id, team_id, opponent_id
),
combined as (
    select
        t.season_id,
        t.team_id,
        t.played, t.won, t.lost, t.no_result, t.points,
        f.runs_for::int, f.balls_for::int,
        a.runs_against::int, a.balls_against::int,
        round(
            (f.runs_for  / (f.balls_for  / 6.0))
          - (a.runs_against / (a.balls_against / 6.0))
        , 3)                                                       as net_run_rate
    from tallies t
    join for_side     f on f.season_id = t.season_id and f.team_id = t.team_id
    join against_side a on a.season_id = t.season_id and a.team_id = t.team_id
)
select
    c.*,
    row_number() over (
        order by c.points desc,
                 c.net_run_rate desc,
                 -- Next rung: head-to-head wins over the tied side. Unreachable
                 -- in practice at three decimals, but it keeps the ordering
                 -- deterministic instead of arbitrary.
                 coalesce((select sum(h.wins) from head_to_head_wins h
                           where h.season_id = c.season_id and h.team_id = c.team_id), 0) desc,
                 c.won desc,
                 c.team_id
    )::int as position
from combined c;

create unique index points_table_pk on marts.points_table (season_id, team_id);
create unique index points_table_position_uq on marts.points_table (season_id, position);
