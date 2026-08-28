-- Season rollups and phase splits.
--
-- These sit on top of the innings cards rather than re-reading `core.delivery`,
-- so the definition of "a batter's runs in an innings" exists in exactly one
-- place. Playoffs are included here (a season total should count the final);
-- only the points table is league-only.

drop materialized view if exists marts.batting_season cascade;
create materialized view marts.batting_season as
select
    b.season_id,
    b.player_id,
    count(*)::int                                          as innings,
    count(distinct b.match_id)::int                        as matches,
    sum(b.runs)::int                                       as runs,
    sum(b.balls_faced)::int                                as balls_faced,
    sum(b.fours)::int                                      as fours,
    sum(b.sixes)::int                                      as sixes,
    sum(b.dots)::int                                       as dots,
    count(*) filter (where b.is_out)::int                  as dismissals,
    count(*) filter (where not b.is_out)::int              as not_outs,
    max(b.runs)::int                                       as highest_score,
    count(*) filter (where b.runs >= 50 and b.runs < 100)::int as fifties,
    count(*) filter (where b.runs >= 100)::int             as hundreds,
    count(*) filter (where b.runs = 0 and b.is_out)::int   as ducks,
    case when sum(b.balls_faced) > 0
         then round(100.0 * sum(b.runs) / sum(b.balls_faced), 2)
    end                                                    as strike_rate,
    -- Null, not infinity, for a batter never dismissed.
    case when count(*) filter (where b.is_out) > 0
         then round(sum(b.runs)::numeric / count(*) filter (where b.is_out), 2)
    end                                                    as average,
    -- Balls per boundary: a compact read on how a batter scores.
    case when (sum(b.fours) + sum(b.sixes)) > 0
         then round(sum(b.balls_faced)::numeric / (sum(b.fours) + sum(b.sixes)), 2)
    end                                                    as balls_per_boundary
from marts.batting_innings b
group by b.season_id, b.player_id;

create unique index batting_season_pk on marts.batting_season (season_id, player_id);
create index batting_season_runs_idx on marts.batting_season (season_id, runs desc);

drop materialized view if exists marts.bowling_season cascade;
create materialized view marts.bowling_season as
select
    w.season_id,
    w.player_id,
    count(*)::int                                          as innings,
    count(distinct w.match_id)::int                        as matches,
    sum(w.balls_bowled)::int                               as balls_bowled,
    sum(w.runs_conceded)::int                              as runs_conceded,
    sum(w.wickets)::int                                    as wickets,
    sum(w.maidens)::int                                    as maidens,
    sum(w.dots)::int                                       as dots,
    sum(w.wides)::int                                      as wides,
    sum(w.noballs)::int                                    as noballs,
    max(w.wickets)::int                                    as best_wickets,
    count(*) filter (where w.wickets >= 4)::int            as four_wicket_hauls,
    count(*) filter (where w.wickets >= 5)::int            as five_wicket_hauls,
    case when sum(w.balls_bowled) > 0
         then round(6.0 * sum(w.runs_conceded) / sum(w.balls_bowled), 2)
    end                                                    as economy,
    case when sum(w.wickets) > 0
         then round(sum(w.runs_conceded)::numeric / sum(w.wickets), 2)
    end                                                    as average,
    case when sum(w.wickets) > 0
         then round(sum(w.balls_bowled)::numeric / sum(w.wickets), 2)
    end                                                    as strike_rate
from marts.bowling_innings w
group by w.season_id, w.player_id;

create unique index bowling_season_pk on marts.bowling_season (season_id, player_id);
create index bowling_season_wickets_idx on marts.bowling_season (season_id, wickets desc);

-- Phase splits.
--
-- One row per player per season per phase per discipline. Keeping batting and
-- bowling in one view with a `discipline` column (rather than two views) means
-- the "is he a death bowler?" comparison is a single indexed read.
drop materialized view if exists marts.phase_splits cascade;
create materialized view marts.phase_splits as
with phased as (
    select
        m.season_id,
        d.over_no,
        case
          when d.over_no <= 5  then 'powerplay'
          when d.over_no <= 14 then 'middle'
          else 'death'
        end::core.innings_phase                            as phase,
        d.striker_id,
        d.bowler_id,
        d.bat_runs,
        d.total_runs,
        d.wide_runs, d.noball_runs,
        d.is_legal_ball,
        d.counts_as_ball_faced,
        d.is_four, d.is_six,
        d.innings_id,
        d.id as delivery_id
    from core.delivery d
    join core.innings i on i.id = d.innings_id
    join core.match m   on m.id = i.match_id
    where not i.is_super_over
),
batting as (
    select season_id, striker_id as player_id, phase,
           'batting'::text                                  as discipline,
           sum(bat_runs)::int                               as runs,
           count(*) filter (where counts_as_ball_faced)::int as balls,
           count(*) filter (where is_four)::int              as fours,
           count(*) filter (where is_six)::int               as sixes,
           count(*) filter (where counts_as_ball_faced and bat_runs = 0)::int as dots,
           0::int                                           as wickets
    from phased group by season_id, striker_id, phase
),
bowling as (
    select p.season_id, p.bowler_id as player_id, p.phase,
           'bowling'::text                                   as discipline,
           sum(p.bat_runs + p.wide_runs + p.noball_runs)::int as runs,
           count(*) filter (where p.is_legal_ball)::int       as balls,
           count(*) filter (where p.is_four)::int             as fours,
           count(*) filter (where p.is_six)::int              as sixes,
           count(*) filter (where p.is_legal_ball and p.total_runs = 0)::int as dots,
           count(ds.id)::int                                  as wickets
    from phased p
    left join core.dismissal ds
           on ds.delivery_id = p.delivery_id and ds.credits_bowler
    group by p.season_id, p.bowler_id, p.phase
),
unioned as (
    select * from batting
    union all
    select * from bowling
)
select
    u.*,
    case when u.balls > 0 and u.discipline = 'batting'
         then round(100.0 * u.runs / u.balls, 2) end          as strike_rate,
    case when u.balls > 0 and u.discipline = 'bowling'
         then round(6.0 * u.runs / u.balls, 2) end            as economy,
    case when u.balls > 0
         then round(100.0 * u.dots / u.balls, 2) end          as dot_percentage
from unioned u;

create unique index phase_splits_pk
    on marts.phase_splits (season_id, player_id, discipline, phase);
create index phase_splits_phase_idx on marts.phase_splits (season_id, discipline, phase);
