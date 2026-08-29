import { describe, expect, it } from 'vitest';

import { transformInnings } from '../deliveries.js';
import type { SourceCommentaryEntry, SourceInningsCommentary } from '../../source/types.js';

/**
 * `transformInnings` is where three of the eight source defects documented in
 * docs/data-model.md are actually handled — this is the highest-value place
 * in the codebase for a unit test to live, and the one the CI unit-test gate
 * had silently stopped running (the package's `test:unit` script had no test
 * files to execute).
 */

function ball(overrides: Partial<SourceCommentaryEntry> = {}): SourceCommentaryEntry {
  return {
    event: 'ball',
    over: '0',
    score: 0,
    event_id: '1',
    batsman_id: '100',
    bowler_id: '900',
    ball: '1',
    run: 1,
    bat_run: '1',
    wide_run: '0',
    noball_run: '0',
    bye_run: '0',
    legbye_run: '0',
    noball: false,
    wideball: false,
    four: false,
    six: false,
    batsmen: [{ batsman_id: '100' }, { batsman_id: '101' }],
    ...overrides,
  };
}

function innings(commentaries: SourceCommentaryEntry[]): SourceInningsCommentary {
  return {
    inning: {
      iid: 1,
      number: 1,
      issuperover: 'false',
      batting_team_id: 1,
      fielding_team_id: 2,
      scores: '0/0',
      scores_full: '0/0 (0 ov)',
      max_over: '20',
      target: '0',
    },
    commentaries,
    teams: [],
    players: [],
  };
}

describe('transformInnings — event filtering', () => {
  it('drops overend entries; they are summaries, not deliveries', () => {
    const src = innings([
      ball({ event_id: '1' }),
      { event: 'overend', over: '1', score: 6 },
      ball({ event_id: '2' }),
    ]);
    const { deliveries } = transformInnings(src);
    expect(deliveries).toHaveLength(2);
    expect(deliveries.map((d) => d.sourceEventId)).toEqual([1, 2]);
  });

  it('keeps wicket events as deliveries — they carry a bowler and runs like any ball', () => {
    const src = innings([
      ball({
        event: 'wicket',
        event_id: '1',
        wicket_batsman_id: '100',
        how_out: 'b A Nortje',
        run: 0,
        bat_run: '0',
      }),
    ]);
    const { deliveries } = transformInnings(src);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.dismissedPlayerId).toBe(100);
  });

  it('leaves dismissedPlayerId null on a ball with no wicket', () => {
    const { deliveries } = transformInnings(innings([ball()]));
    expect(deliveries[0]!.dismissedPlayerId).toBeNull();
  });
});

describe('transformInnings — delivery_seq', () => {
  it('is monotonic starting at 1, skipping overend entries entirely', () => {
    const src = innings([
      ball({ event_id: '1' }),
      ball({ event_id: '2' }),
      { event: 'overend', over: '1', score: 12 },
      ball({ event_id: '3' }),
    ]);
    const { deliveries } = transformInnings(src);
    expect(deliveries.map((d) => d.deliverySeq)).toEqual([1, 2, 3]);
  });

  it('assigns a fresh seq even when (over, ball) repeats — the actual landmine', () => {
    // A wide followed by the retry: the source often reuses the ball number.
    const src = innings([
      ball({
        event_id: '1',
        over: '3',
        ball: '2',
        wideball: true,
        wide_run: '1',
        run: 1,
        bat_run: '0',
      }),
      ball({ event_id: '2', over: '3', ball: '2', run: 0, bat_run: '0' }),
    ]);
    const { deliveries } = transformInnings(src);
    expect(deliveries.map((d) => [d.overNo, d.ballInOver])).toEqual([
      [3, 2],
      [3, 2],
    ]);
    // Same (over, ball) pair — delivery_seq is the only thing that still
    // orders them correctly.
    expect(deliveries.map((d) => d.deliverySeq)).toEqual([1, 2]);
  });
});

describe('transformInnings — non-striker resolution', () => {
  it('picks whichever of the two batsmen is not on strike', () => {
    const src = innings([
      ball({ batsman_id: '100', batsmen: [{ batsman_id: '101' }, { batsman_id: '100' }] }),
    ]);
    expect(transformInnings(src).deliveries[0]!.nonStrikerId).toBe(101);
  });

  it('recovers the non-striker from the previous pair when the source lists the striker twice', () => {
    // The two-of-17,912 glitch: `batsmen` names the striker on both sides.
    const src = innings([
      ball({
        event_id: '1',
        batsman_id: '100',
        batsmen: [{ batsman_id: '100' }, { batsman_id: '101' }],
      }),
      ball({
        event_id: '2',
        batsman_id: '100',
        batsmen: [{ batsman_id: '100' }, { batsman_id: '100' }],
      }),
    ]);
    const { deliveries } = transformInnings(src);
    expect(deliveries[1]!.nonStrikerId).toBe(101);
  });

  it('throws rather than guess when there is no previous pair to fall back on', () => {
    const src = innings([
      ball({
        event_id: '1',
        batsman_id: '100',
        batsmen: [{ batsman_id: '100' }, { batsman_id: '100' }],
      }),
    ]);
    expect(() => transformInnings(src)).toThrow(/non-striker/i);
  });

  it('updates the crease pair only after a delivery resolves, not before', () => {
    // Over the course of an over the pair can rotate on strike; the "previous
    // pair" fallback must track the pair as it actually was, not the initial one.
    const src = innings([
      ball({
        event_id: '1',
        batsman_id: '100',
        batsmen: [{ batsman_id: '100' }, { batsman_id: '101' }],
      }),
      ball({
        event_id: '2',
        batsman_id: '101',
        batsmen: [{ batsman_id: '101' }, { batsman_id: '100' }],
      }),
      ball({
        event_id: '3',
        batsman_id: '101',
        batsmen: [{ batsman_id: '101' }, { batsman_id: '101' }],
      }),
    ]);
    const { deliveries } = transformInnings(src);
    // Third ball: striker is 101 twice in the glitch; the previous pair was
    // (101, 100), so the non-striker recovers as 100.
    expect(deliveries[2]!.nonStrikerId).toBe(100);
  });
});

describe('transformInnings — run component repair', () => {
  it('passes through deliveries whose components already sum correctly', () => {
    const src = innings([ball({ run: 4, bat_run: '4' })]);
    const { deliveries, componentRepairs } = transformInnings(src);
    expect(componentRepairs).toHaveLength(0);
    expect(deliveries[0]!.totalRuns).toBe(4);
    expect(deliveries[0]!.byeRuns).toBe(0);
  });

  it('recovers a shortfall as byes and records the repair — the "5 no ball" case', () => {
    // Exactly the real shape: run=5, noball_run=1, everything else zero.
    const src = innings([
      ball({
        event_id: '42',
        run: 5,
        bat_run: '0',
        noball_run: '1',
        noball: true,
        commentary: 'X to Y, 5 no ball,',
      }),
    ]);
    const { deliveries, componentRepairs } = transformInnings(src);

    expect(componentRepairs).toHaveLength(1);
    expect(componentRepairs[0]).toMatchObject({
      sourceEventId: 42,
      componentSum: 1,
      reportedTotal: 5,
      residual: 4,
    });

    // The repaired delivery still reports the source's total, with the
    // residual folded into byes so the components sum correctly downstream.
    expect(deliveries[0]!.totalRuns).toBe(5);
    expect(deliveries[0]!.byeRuns).toBe(4);
    expect(
      deliveries[0]!.batRuns +
        deliveries[0]!.wideRuns +
        deliveries[0]!.noballRuns +
        deliveries[0]!.byeRuns +
        deliveries[0]!.legbyeRuns,
    ).toBe(5);
  });

  it('adds the residual on top of any bye runs already present, rather than replacing them', () => {
    const src = innings([ball({ run: 5, bat_run: '0', bye_run: '1' })]);
    const { deliveries } = transformInnings(src);
    // component sum = 1 (existing bye), residual = 4, total bye = 5
    expect(deliveries[0]!.byeRuns).toBe(5);
  });

  it('refuses a delivery whose components exceed its reported total', () => {
    const src = innings([ball({ run: 1, bat_run: '4' })]);
    expect(() => transformInnings(src)).toThrow(/reports 1 runs but its components sum to 4/);
  });
});

describe('transformInnings — boundaries and metadata', () => {
  it('reads four and six flags straight through', () => {
    const src = innings([
      ball({ event_id: '1', four: true, run: 4, bat_run: '4' }),
      ball({ event_id: '2', six: true, run: 6, bat_run: '6' }),
    ]);
    const { deliveries } = transformInnings(src);
    expect(deliveries[0]).toMatchObject({ isFour: true, isSix: false });
    expect(deliveries[1]).toMatchObject({ isFour: false, isSix: true });
  });

  it('converts an epoch timestamp to an ISO string, not a Date', () => {
    const src = innings([ball({ timestamp: 1_652_018_430 })]);
    const ts = transformInnings(src).deliveries[0]!.ballTimestamp;
    expect(typeof ts).toBe('string');
    expect(ts).toBe(new Date(1_652_018_430 * 1000).toISOString());
  });

  it('leaves ballTimestamp null when the source omits it', () => {
    const src = innings([ball({ timestamp: undefined })]);
    expect(transformInnings(src).deliveries[0]!.ballTimestamp).toBeNull();
  });
});
