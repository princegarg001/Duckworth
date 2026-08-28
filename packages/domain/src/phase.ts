/**
 * Innings phases.
 *
 * A T20 innings is conventionally read in three blocks, and almost every
 * interesting question about a player ("is he a death bowler?") is a phase
 * question. Overs are **0-indexed** here, matching `core.delivery.over_no`:
 *
 *   powerplay  overs 0–5   (the fielding restriction)
 *   middle     overs 6–14
 *   death      overs 15–19
 */

export const PHASES = ['powerplay', 'middle', 'death'] as const;
export type Phase = (typeof PHASES)[number];

export const PHASE_BOUNDS: Readonly<Record<Phase, { from: number; to: number }>> = {
  powerplay: { from: 0, to: 5 },
  middle: { from: 6, to: 14 },
  death: { from: 15, to: 19 },
};

export const PHASE_LABELS: Readonly<Record<Phase, string>> = {
  powerplay: 'Powerplay (ov 1–6)',
  middle: 'Middle (ov 7–15)',
  death: 'Death (ov 16–20)',
};

/**
 * Classify a 0-indexed over number.
 *
 * Overs beyond 19 can occur in a super over or in malformed data; they are
 * clamped into `death` rather than throwing, because a phase split should
 * never be the thing that fails a request.
 */
export function phaseForOver(overNo: number): Phase {
  if (overNo <= PHASE_BOUNDS.powerplay.to) return 'powerplay';
  if (overNo <= PHASE_BOUNDS.middle.to) return 'middle';
  return 'death';
}

/** Human-facing over label: `over_no` 0 is "the 1st over". */
export function overLabel(overNo: number): number {
  return overNo + 1;
}
