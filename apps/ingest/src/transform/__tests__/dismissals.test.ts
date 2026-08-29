import { describe, expect, it } from 'vitest';

import { transformDismissals } from '../dismissals.js';
import type { DeliveryRow } from '../deliveries.js';
import type {
  SourceScorecardBatsman,
  SourceScorecardFielder,
  SourceScorecardFow,
  SourceScorecardInnings,
} from '../../source/types.js';

/**
 * `transformDismissals` joins two independent source views on
 * `(innings, player dismissed)` and applies the domain's bowler-credit rule.
 * The retired-hurt case and the caught-and-bowled detection are the two
 * places this dataset actually exercises the interesting paths documented in
 * ADR 0003 and docs/data-model.md.
 */

function batsman(overrides: Partial<SourceScorecardBatsman> = {}): SourceScorecardBatsman {
  return {
    batsman_id: '100',
    name: 'Test Batter',
    runs: '25',
    balls_faced: '20',
    fours: '2',
    sixes: '1',
    strike_rate: '125.00',
    how_out: 'b A Nortje',
    dismissal: 'bowled',
    bowler_id: '900',
    first_fielder_id: '',
    second_fielder_id: '',
    third_fielder_id: '',
    ...overrides,
  };
}

function card(
  batsmen: SourceScorecardBatsman[],
  opts: { fows?: SourceScorecardFow[]; fielder?: SourceScorecardFielder[] } = {},
): SourceScorecardInnings {
  return {
    iid: 1,
    number: 1,
    name: 'Test Innings',
    short_name: 'TI',
    batting_team_id: 1,
    fielding_team_id: 2,
    issuperover: 'false',
    scores: '0/0',
    scores_full: '0/0',
    max_over: '20',
    batsmen,
    bowlers: [],
    fows: opts.fows ?? [],
    fielder: opts.fielder ?? [],
    did_not_bat: [],
    extra_runs: { byes: 0, legbyes: 0, wides: 0, noballs: 0, penalty: 0, total: 0 },
    equations: { runs: 0, wickets: 0, overs: '0', runrate: '0' },
  };
}

function deliveryFor(playerOutId: number, seq: number): DeliveryRow {
  return {
    inningsId: 1,
    deliverySeq: seq,
    overNo: 0,
    ballInOver: 1,
    strikerId: playerOutId,
    nonStrikerId: playerOutId + 1,
    bowlerId: 900,
    batRuns: 0,
    wideRuns: 0,
    noballRuns: 0,
    byeRuns: 0,
    legbyeRuns: 0,
    totalRuns: 0,
    isFour: false,
    isSix: false,
    commentary: null,
    sourceEventId: seq,
    ballTimestamp: null,
    dismissedPlayerId: playerOutId,
  };
}

describe('transformDismissals — not-out filtering', () => {
  it('skips a batsman with no dismissal string', () => {
    const rows = transformDismissals(card([batsman({ dismissal: '' })]), []);
    expect(rows).toHaveLength(0);
  });
});

describe('transformDismissals — the retired-hurt case', () => {
  it('emits a null deliverySeq for a retired hurt, and does not throw', () => {
    const rows = transformDismissals(
      card([batsman({ dismissal: 'retired', how_out: 'retired hurt' })]),
      [],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe('retired_hurt');
    expect(rows[0]!.deliverySeq).toBeNull();
    expect(rows[0]!.countsAsWicketLost).toBe(false);
  });

  it('throws if any OTHER dismissal kind has no matching delivery', () => {
    // A bowled with no delivery in the batch is a real join failure, not the
    // one legitimate case (retired hurt) — it must not be silently accepted.
    expect(() => transformDismissals(card([batsman({ dismissal: 'bowled' })]), [])).toThrow(
      /has no delivery/,
    );
  });

  it('joins a normal dismissal to its delivery by (innings, player)', () => {
    const rows = transformDismissals(card([batsman({ batsman_id: '100', dismissal: 'bowled' })]), [
      deliveryFor(100, 7),
    ]);
    expect(rows[0]!.deliverySeq).toBe(7);
  });
});

describe('transformDismissals — bowler credit', () => {
  it('credits the bowler for a bowled dismissal', () => {
    const rows = transformDismissals(
      card([batsman({ batsman_id: '100', dismissal: 'bowled', bowler_id: '900' })]),
      [deliveryFor(100, 1)],
    );
    expect(rows[0]!.creditsBowler).toBe(true);
    expect(rows[0]!.bowlerId).toBe(900);
  });

  it('never credits the bowler for a run-out, even though the source lists one', () => {
    // The scorecard names the bowler at the time of a run-out; that must not
    // become a wicket in their bowling figures.
    const rows = transformDismissals(
      card([batsman({ batsman_id: '100', dismissal: 'runout', bowler_id: '900' })]),
      [deliveryFor(100, 1)],
    );
    expect(rows[0]!.creditsBowler).toBe(false);
    expect(rows[0]!.bowlerId).toBeNull();
  });

  it('never credits the bowler for a retired hurt or retired out', () => {
    const rows = transformDismissals(
      card([
        batsman({ batsman_id: '100', dismissal: 'retired', bowler_id: '900' }),
        batsman({ batsman_id: '101', dismissal: 'retiredout', bowler_id: '900' }),
      ]),
      [deliveryFor(101, 1)],
    );
    expect(rows.every((r) => !r.creditsBowler && r.bowlerId === null)).toBe(true);
  });
});

describe('transformDismissals — caught and bowled', () => {
  it('refines a caught into caught_and_bowled when the fielder is the bowler', () => {
    const rows = transformDismissals(
      card([
        batsman({
          batsman_id: '100',
          dismissal: 'caught',
          bowler_id: '900',
          first_fielder_id: '900',
        }),
      ]),
      [deliveryFor(100, 1)],
    );
    expect(rows[0]!.kind).toBe('caught_and_bowled');
    expect(rows[0]!.creditsBowler).toBe(true);
  });

  it('does not record the bowler again as a fielder on a caught-and-bowled', () => {
    const rows = transformDismissals(
      card([
        batsman({
          batsman_id: '100',
          dismissal: 'caught',
          bowler_id: '900',
          first_fielder_id: '900',
        }),
      ]),
      [deliveryFor(100, 1)],
    );
    expect(rows[0]!.fielders).toHaveLength(0);
  });

  it('leaves an ordinary catch as caught, with the fielder recorded', () => {
    const rows = transformDismissals(
      card([
        batsman({
          batsman_id: '100',
          dismissal: 'caught',
          bowler_id: '900',
          first_fielder_id: '555',
        }),
      ]),
      [deliveryFor(100, 1)],
    );
    expect(rows[0]!.kind).toBe('caught');
    expect(rows[0]!.fielders).toEqual([{ playerId: 555, ordinal: 1, isSubstitute: false }]);
  });
});

describe('transformDismissals — fielders and substitutes', () => {
  it('records up to three fielders in ordinal order, skipping unfilled slots', () => {
    const rows = transformDismissals(
      card([
        batsman({
          batsman_id: '100',
          dismissal: 'runout',
          first_fielder_id: '555',
          second_fielder_id: '',
          third_fielder_id: '556',
        }),
      ]),
      [deliveryFor(100, 1)],
    );
    expect(rows[0]!.fielders).toEqual([
      { playerId: 555, ordinal: 1, isSubstitute: false },
      { playerId: 556, ordinal: 3, isSubstitute: false },
    ]);
  });

  it('flags a fielder as a substitute from the fielding list', () => {
    const rows = transformDismissals(
      card([batsman({ batsman_id: '100', dismissal: 'caught', first_fielder_id: '555' })], {
        fielder: [
          {
            fielder_id: '555',
            fielder_name: 'Sub Fielder',
            catches: 1,
            runout_catcher: 0,
            runout_direct_hit: 0,
            runout_thrower: 0,
            stumping: 0,
            is_substitute: 'true',
          },
        ],
      }),
      [deliveryFor(100, 1)],
    );
    expect(rows[0]!.fielders[0]).toEqual({ playerId: 555, ordinal: 1, isSubstitute: true });
  });
});

describe('transformDismissals — wicket ordering', () => {
  it('orders by the fall-of-wickets number when present', () => {
    const rows = transformDismissals(
      card(
        [
          batsman({ batsman_id: '100', dismissal: 'bowled' }),
          batsman({ batsman_id: '101', dismissal: 'caught' }),
        ],
        {
          fows: [
            {
              batsman_id: '101',
              bowler_id: '900',
              dismissal: 'caught',
              how_out: '',
              name: '',
              number: 1,
              overs_at_dismissal: '1.2',
              runs: '10',
              balls: '8',
              score_at_dismissal: 12,
            },
            {
              batsman_id: '100',
              bowler_id: '900',
              dismissal: 'bowled',
              how_out: '',
              name: '',
              number: 2,
              overs_at_dismissal: '3.1',
              runs: '5',
              balls: '4',
              score_at_dismissal: 20,
            },
          ],
        },
      ),
      [deliveryFor(100, 1), deliveryFor(101, 2)],
    );
    // Batsman 101 fell first (fow number 1) despite appearing second in the
    // card's own batting order.
    expect(rows.map((r) => r.playerOutId)).toEqual([101, 100]);
    expect(rows[0]!.teamScoreAtDismissal).toBe(12);
  });

  it('falls back to card order when no fall-of-wickets data is present', () => {
    const rows = transformDismissals(
      card([
        batsman({ batsman_id: '100', dismissal: 'bowled' }),
        batsman({ batsman_id: '101', dismissal: 'caught' }),
      ]),
      [deliveryFor(100, 1), deliveryFor(101, 2)],
    );
    expect(rows.map((r) => r.wicketNumber)).toEqual([1, 2]);
  });
});
