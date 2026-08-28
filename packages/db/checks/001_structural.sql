-- Structural integrity of the delivery grain.
--
-- Each check is a SELECT that returns the OFFENDING rows. Zero rows is a pass.
-- The runner reports the count and a sample, so a failure is debuggable from
-- the pipeline log without anyone opening psql.

-- name: every_match_has_two_innings
-- description: Every match must have exactly two innings (no super overs in this season).
select m.id as match_id, m.short_title, count(i.id) as innings_count
from core.match m
left join core.innings i on i.match_id = m.id
group by m.id, m.short_title
having count(i.id) <> 2;

-- name: no_over_exceeds_six_legal_balls
-- description: A completed over contains at most six legal deliveries.
select i.match_id, d.innings_id, d.over_no, count(*) as legal_balls
from core.delivery d
join core.innings i on i.id = d.innings_id
where d.is_legal_ball
group by i.match_id, d.innings_id, d.over_no
having count(*) > 6;

-- name: innings_within_allotted_overs
-- description: No innings exceeds its allotted overs.
select d.innings_id, i.allotted_overs, max(d.over_no) + 1 as overs_used
from core.delivery d
join core.innings i on i.id = d.innings_id
where not i.is_super_over
group by d.innings_id, i.allotted_overs
having max(d.over_no) + 1 > i.allotted_overs;

-- name: delivery_sequence_is_contiguous
-- description: delivery_seq must run 1..N with no gaps inside an innings.
select innings_id, count(*) as deliveries, max(delivery_seq) as max_seq, min(delivery_seq) as min_seq
from core.delivery
group by innings_id
having min(delivery_seq) <> 1 or max(delivery_seq) <> count(*);

-- name: striker_is_not_bowler
-- description: A player cannot bat and bowl on the same delivery.
select id, innings_id, delivery_seq, striker_id, bowler_id
from core.delivery
where striker_id = bowler_id or non_striker_id = bowler_id;

-- name: wicket_count_within_innings
-- description: An innings cannot lose more than ten wickets.
select innings_id, count(*) as wickets
from core.dismissal
where counts_as_wicket_lost
group by innings_id
having count(*) > 10;

-- name: dismissal_belongs_to_its_innings
-- description: A dismissal's delivery must belong to the same innings as the dismissal.
select ds.id as dismissal_id, ds.innings_id, d.innings_id as delivery_innings_id
from core.dismissal ds
join core.delivery d on d.id = ds.delivery_id
where d.innings_id <> ds.innings_id;

-- name: bowler_credit_matches_dismissal_kind
-- description: Run-outs and retirements must never be credited to a bowler.
select id, innings_id, player_out_id, kind, bowler_id, credits_bowler
from core.dismissal
where (kind in ('run_out','retired_out','retired_hurt','obstructing_the_field','timed_out')
       and (credits_bowler or bowler_id is not null))
   or (kind in ('bowled','caught','caught_and_bowled','lbw','stumped','hit_wicket')
       and not credits_bowler);

-- name: only_retired_hurt_lacks_a_delivery
-- description: Every dismissal except retired hurt must sit on a delivery.
select id, innings_id, player_out_id, kind
from core.dismissal
where delivery_id is null and kind <> 'retired_hurt';

-- name: match_winner_played_the_match
-- description: The winner must be one of the two participants.
select id, short_title, winner_id, team_a_id, team_b_id
from core.match
where winner_id is not null and winner_id not in (team_a_id, team_b_id);

-- name: no_orphan_players_in_deliveries
-- description: Every player referenced by a delivery must exist.
select d.id, d.striker_id, d.non_striker_id, d.bowler_id
from core.delivery d
where not exists (select 1 from core.player p where p.id = d.striker_id)
   or not exists (select 1 from core.player p where p.id = d.non_striker_id)
   or not exists (select 1 from core.player p where p.id = d.bowler_id);

-- name: every_match_has_officials
-- description: Every match should record its on-field and TV umpires.
select m.id, m.short_title, count(mo.official_id) as officials
from core.match m
left join core.match_official mo on mo.match_id = m.id and mo.role in ('field','tv')
group by m.id, m.short_title
having count(mo.official_id) < 3;

-- name: delivery_components_sum_to_total
-- description: After repair, every delivery's run components must sum to its total.
select id, innings_id, delivery_seq, total_runs,
       (bat_runs + wide_runs + noball_runs + bye_runs + legbye_runs) as component_sum
from core.delivery
where (bat_runs + wide_runs + noball_runs + bye_runs + legbye_runs) <> total_runs;
