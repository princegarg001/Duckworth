-- Partnerships, head-to-head and venue profiles.

-- Partnerships.
--
-- A partnership is the run of deliveries between two falls of wicket. There is
-- no partnership column in the source, so it is reconstructed with a window
-- function: count the wickets that have already fallen *before* each delivery,
-- and that count is the partnership's index within the innings. Deliveries then
-- group by it.
--
-- The subtlety is `rows between unbounded preceding and current row` on a
-- running count of dismissals — a wicket ends the partnership it belongs to, so
-- the wicket delivery must be counted in the *current* group, not the next one.
drop materialized view if exists marts.partnership cascade;
create materialized view marts.partnership as
with numbered as (
    select
        d.innings_id,
        d.id            as delivery_id,
        d.delivery_seq,
        d.striker_id,
        d.non_striker_id,
        d.bat_runs,
        d.total_runs,
        d.is_legal_ball,
        d.counts_as_ball_faced,
        -- Wickets that fell strictly before this delivery.
        coalesce(sum(case when ds.id is not null then 1 else 0 end)
                 over (partition by d.innings_id order by d.delivery_seq
                       rows between unbounded preceding and 1 preceding), 0)::int
                        as wicket_index
    from core.delivery d
    left join core.dismissal ds
           on ds.delivery_id = d.id and ds.counts_as_wicket_lost
),
grouped as (
    select
        n.innings_id,
        n.wicket_index,
        min(n.delivery_seq)::int                        as first_delivery_seq,
        max(n.delivery_seq)::int                        as last_delivery_seq,
        sum(n.total_runs)::int                          as runs,
        count(*) filter (where n.is_legal_ball)::int     as balls,
        -- The pair at the crease. Ordered so the same two players always
        -- produce the same (a, b) and the unique index is stable.
        least(min(n.striker_id), min(n.non_striker_id))::int    as player_a_id,
        greatest(max(n.striker_id), max(n.non_striker_id))::int as player_b_id
    from numbered n
    group by n.innings_id, n.wicket_index
)
select
    g.innings_id,
    i.match_id,
    m.season_id,
    i.batting_team_id,
    (g.wicket_index + 1)::int                            as wicket_number,
    g.player_a_id,
    g.player_b_id,
    g.runs,
    g.balls,
    g.first_delivery_seq,
    g.last_delivery_seq,
    -- Whether the stand was broken or was unbeaten at the end of the innings.
    exists (
      select 1 from core.dismissal ds
      join core.delivery d2 on d2.id = ds.delivery_id
      where d2.innings_id = g.innings_id
        and d2.delivery_seq = g.last_delivery_seq
        and ds.counts_as_wicket_lost
    )                                                     as was_broken,
    case when g.balls > 0 then round(6.0 * g.runs / g.balls, 2) end as run_rate
from grouped g
join core.innings i on i.id = g.innings_id
join core.match m   on m.id = i.match_id
where not i.is_super_over;

create unique index partnership_pk on marts.partnership (innings_id, wicket_number);
create index partnership_match_idx on marts.partnership (match_id);
create index partnership_players_idx on marts.partnership (player_a_id, player_b_id);

-- Head-to-head between two teams.
--
-- Emitted twice per fixture, once from each side's perspective, so a lookup is
-- a single-key read rather than an OR across two columns.
drop materialized view if exists marts.head_to_head cascade;
create materialized view marts.head_to_head as
with sides as (
    select m.season_id, m.id as match_id, m.match_date, s.team_id, s.opponent_id,
           case
             when m.winner_id is null     then 'no_result'
             when m.winner_id = s.team_id then 'win'
             else 'loss'
           end as outcome
    from core.match m
    cross join lateral (
        values (m.team_a_id, m.team_b_id), (m.team_b_id, m.team_a_id)
    ) as s(team_id, opponent_id)
)
select
    season_id,
    team_id,
    opponent_id,
    count(*)::int                                       as played,
    count(*) filter (where outcome = 'win')::int         as won,
    count(*) filter (where outcome = 'loss')::int        as lost,
    count(*) filter (where outcome = 'no_result')::int   as no_result,
    max(match_date)                                     as last_played,
    case when count(*) > 0
         then round(100.0 * count(*) filter (where outcome = 'win') / count(*), 1)
    end                                                 as win_percentage
from sides
group by season_id, team_id, opponent_id;

create unique index head_to_head_pk on marts.head_to_head (season_id, team_id, opponent_id);

-- Venue profile.
--
-- The questions a commentator asks at the toss: does the pitch favour batting
-- first, and does the toss actually matter here?
drop materialized view if exists marts.venue_profile cascade;
create materialized view marts.venue_profile as
with first_innings as (
    select m.id as match_id, m.season_id, m.venue_id, s.runs, s.wickets, s.legal_balls
    from core.match m
    join core.innings i on i.match_id = m.id and i.innings_no = 1
    join marts.innings_summary s on s.innings_id = i.id
),
chases as (
    select m.id as match_id, m.venue_id,
           -- The chasing side is whoever batted second.
           (m.winner_id is not null and m.winner_id = i2.batting_team_id) as chase_won,
           (m.toss_winner_id is not null and m.winner_id = m.toss_winner_id) as toss_winner_won,
           m.toss_decision
    from core.match m
    join core.innings i2 on i2.match_id = m.id and i2.innings_no = 2
)
select
    f.season_id,
    f.venue_id,
    count(*)::int                                            as matches,
    round(avg(f.runs), 1)                                    as avg_first_innings_score,
    max(f.runs)::int                                         as highest_first_innings,
    min(f.runs)::int                                         as lowest_first_innings,
    count(*) filter (where c.chase_won)::int                 as chases_won,
    round(100.0 * count(*) filter (where c.chase_won) / nullif(count(*), 0), 1)
                                                             as chase_win_percentage,
    count(*) filter (where c.toss_decision = 'bat')::int      as toss_chose_bat,
    count(*) filter (where c.toss_decision = 'field')::int    as toss_chose_field,
    round(100.0 * count(*) filter (where c.toss_winner_won) / nullif(count(*), 0), 1)
                                                             as toss_winner_win_percentage
from first_innings f
join chases c on c.match_id = f.match_id
group by f.season_id, f.venue_id;

create unique index venue_profile_pk on marts.venue_profile (season_id, venue_id);
