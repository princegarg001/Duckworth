-- Per-innings batting and bowling cards, derived entirely from deliveries.
--
-- These are the foundation the season rollups sit on. Every matview here gets a
-- UNIQUE index, which is not decoration: REFRESH MATERIALIZED VIEW CONCURRENTLY
-- refuses to run without one, and a non-concurrent refresh takes an
-- ACCESS EXCLUSIVE lock that would stall every read on the site.

drop materialized view if exists marts.batting_innings cascade;
create materialized view marts.batting_innings as
select
    d.innings_id,
    i.match_id,
    m.season_id,
    m.stage,
    m.match_date,
    m.venue_id,
    d.striker_id                                          as player_id,
    i.batting_team_id                                     as team_id,
    i.bowling_team_id                                     as opponent_team_id,
    i.innings_no,
    sum(d.bat_runs)::int                                  as runs,
    -- Balls faced excludes wides but includes no-balls.
    count(*) filter (where d.counts_as_ball_faced)::int    as balls_faced,
    count(*) filter (where d.is_four)::int                 as fours,
    count(*) filter (where d.is_six)::int                  as sixes,
    count(*) filter (where d.counts_as_ball_faced and d.bat_runs = 0)::int as dots,
    -- Null, not Infinity, when no ball was faced.
    case when count(*) filter (where d.counts_as_ball_faced) > 0
         then round(100.0 * sum(d.bat_runs)
                    / count(*) filter (where d.counts_as_ball_faced), 2)
    end                                                   as strike_rate,
    ds.kind                                               as dismissal_kind,
    (ds.id is not null and ds.counts_as_wicket_lost)      as is_out,
    min(d.delivery_seq)::int                              as first_delivery_seq
from core.delivery d
join core.innings i on i.id = d.innings_id
join core.match   m on m.id = i.match_id
left join core.dismissal ds
       on ds.innings_id = d.innings_id and ds.player_out_id = d.striker_id
where not i.is_super_over
group by d.innings_id, i.match_id, m.season_id, m.stage, m.match_date, m.venue_id,
         d.striker_id, i.batting_team_id, i.bowling_team_id, i.innings_no,
         ds.kind, ds.id, ds.counts_as_wicket_lost;

create unique index batting_innings_pk on marts.batting_innings (innings_id, player_id);
create index batting_innings_player_idx on marts.batting_innings (player_id);
create index batting_innings_season_idx on marts.batting_innings (season_id, stage);
create index batting_innings_match_idx on marts.batting_innings (match_id);

drop materialized view if exists marts.bowling_innings cascade;
create materialized view marts.bowling_innings as
with per_over as (
    -- A maiden is a completed over conceding nothing chargeable to the bowler.
    -- Byes and leg-byes do not break a maiden; a wide or a no-ball does.
    select d.innings_id, d.bowler_id, d.over_no,
           count(*) filter (where d.is_legal_ball)          as legal_balls,
           sum(d.bat_runs + d.wide_runs + d.noball_runs)    as chargeable_runs
    from core.delivery d
    group by d.innings_id, d.bowler_id, d.over_no
),
maidens as (
    select innings_id, bowler_id, count(*)::int as maidens
    from per_over
    where legal_balls = 6 and chargeable_runs = 0
    group by innings_id, bowler_id
)
select
    d.innings_id,
    i.match_id,
    m.season_id,
    m.stage,
    m.match_date,
    m.venue_id,
    d.bowler_id                                           as player_id,
    i.bowling_team_id                                     as team_id,
    i.batting_team_id                                     as opponent_team_id,
    i.innings_no,
    count(*) filter (where d.is_legal_ball)::int           as balls_bowled,
    -- The bowler is charged runs off the bat, wides and no-balls; never byes
    -- or leg-byes, which are the keeper's problem.
    sum(d.bat_runs + d.wide_runs + d.noball_runs)::int     as runs_conceded,
    coalesce(w.wickets, 0)::int                           as wickets,
    coalesce(mn.maidens, 0)::int                          as maidens,
    sum(d.wide_runs)::int                                 as wides,
    sum(d.noball_runs)::int                               as noballs,
    count(*) filter (where d.is_legal_ball and d.total_runs = 0)::int as dots,
    case when count(*) filter (where d.is_legal_ball) > 0
         then round(6.0 * sum(d.bat_runs + d.wide_runs + d.noball_runs)
                    / count(*) filter (where d.is_legal_ball), 2)
    end                                                   as economy
from core.delivery d
join core.innings i on i.id = d.innings_id
join core.match   m on m.id = i.match_id
left join (
    select innings_id, bowler_id, count(*)::int as wickets
    from core.dismissal
    where credits_bowler
    group by innings_id, bowler_id
) w on w.innings_id = d.innings_id and w.bowler_id = d.bowler_id
left join maidens mn on mn.innings_id = d.innings_id and mn.bowler_id = d.bowler_id
where not i.is_super_over
group by d.innings_id, i.match_id, m.season_id, m.stage, m.match_date, m.venue_id,
         d.bowler_id, i.bowling_team_id, i.batting_team_id, i.innings_no,
         w.wickets, mn.maidens;

create unique index bowling_innings_pk on marts.bowling_innings (innings_id, player_id);
create index bowling_innings_player_idx on marts.bowling_innings (player_id);
create index bowling_innings_season_idx on marts.bowling_innings (season_id, stage);
create index bowling_innings_match_idx on marts.bowling_innings (match_id);

-- Innings totals, so a scorecard header is one indexed read rather than a
-- re-aggregation of every delivery in the match.
drop materialized view if exists marts.innings_summary cascade;
create materialized view marts.innings_summary as
select
    i.id                                                  as innings_id,
    i.match_id,
    m.season_id,
    i.innings_no,
    i.batting_team_id,
    i.bowling_team_id,
    i.is_super_over,
    i.allotted_overs,
    i.target,
    coalesce(sum(d.total_runs), 0)::int                    as runs,
    count(*) filter (where d.is_legal_ball)::int           as legal_balls,
    coalesce(w.wickets, 0)::int                           as wickets,
    coalesce(sum(d.extra_runs), 0)::int                    as extras,
    count(*) filter (where d.is_four)::int                 as fours,
    count(*) filter (where d.is_six)::int                  as sixes,
    case when count(*) filter (where d.is_legal_ball) > 0
         then round(6.0 * sum(d.total_runs)
                    / count(*) filter (where d.is_legal_ball), 2)
    end                                                   as run_rate
from core.innings i
join core.match m on m.id = i.match_id
left join core.delivery d on d.innings_id = i.id
left join (
    select innings_id, count(*)::int as wickets
    from core.dismissal
    where counts_as_wicket_lost
    group by innings_id
) w on w.innings_id = i.id
group by i.id, i.match_id, m.season_id, i.innings_no, i.batting_team_id,
         i.bowling_team_id, i.is_super_over, i.allotted_overs, i.target, w.wickets;

create unique index innings_summary_pk on marts.innings_summary (innings_id);
create index innings_summary_match_idx on marts.innings_summary (match_id);
