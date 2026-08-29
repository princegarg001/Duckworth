import Link from 'next/link';

import { Card, Rate, TeamBadge } from './primitives';

/**
 * A full innings scorecard: batting, bowling, fall of wickets and partnerships.
 *
 * Rendered as real `<table>` elements with proper `<caption>`, `scope` and
 * `<th>` markup, because a scorecard *is* tabular data and a screen reader
 * should be able to navigate it as one.
 */

interface PlayerRef {
  id: number;
  fullName: string;
  shortName: string;
}

interface InningsProps {
  innings: {
    id: number;
    inningsNo: number;
    battingTeam: { id: number; name: string; shortName: string };
    bowlingTeam: { id: number; name: string; shortName: string };
    runs: number;
    wickets: number;
    overs: string;
    runRate: number | null;
    target: number | null;
    extras: {
      byes: number;
      legbyes: number;
      wides: number;
      noballs: number;
      penalty: number;
      total: number;
    };
    batting: {
      player: PlayerRef;
      runs: number;
      ballsFaced: number;
      fours: number;
      sixes: number;
      strikeRate: number | null;
      isOut: boolean;
      howOut: string | null;
    }[];
    bowling: {
      player: PlayerRef;
      overs: string;
      runsConceded: number;
      wickets: number;
      maidens: number;
      economy: number | null;
      wides: number;
      noballs: number;
    }[];
    fallOfWickets: {
      wicketNumber: number;
      playerOut: PlayerRef;
      teamScore: number | null;
      overs: string | null;
    }[];
    partnerships: {
      wicketNumber: number;
      playerA: PlayerRef;
      playerB: PlayerRef;
      runs: number;
      balls: number;
      wasBroken: boolean;
    }[];
  };
}

export function Scorecard({ innings: i }: InningsProps) {
  const topPartnership = [...i.partnerships].sort((a, b) => b.runs - a.runs)[0];

  return (
    <Card
      padded={false}
      title={`${i.battingTeam.name} — ${i.runs}/${i.wickets} (${i.overs})`}
      description={`v ${i.bowlingTeam.name}${i.target !== null ? ` · target ${i.target}` : ''}`}
    >
      <div className="scroll-x">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{i.battingTeam.name} batting</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-ink-muted">
                Batter
              </th>
              {['R', 'B', '4s', '6s', 'SR'].map((h) => (
                <th
                  key={h}
                  scope="col"
                  className="px-3 py-2 text-right text-xs font-medium text-ink-muted"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {i.batting.map((b) => (
              <tr key={b.player.id} className="border-b border-line/60 last:border-0">
                <th scope="row" className="px-4 py-2 text-left font-normal">
                  <Link
                    href={`/players/${b.player.id}`}
                    className="font-medium text-ink hover:underline underline-offset-2"
                  >
                    {b.player.fullName}
                  </Link>
                  <span className="block text-xs text-ink-faint">
                    {b.isOut ? (b.howOut ?? 'out') : 'not out'}
                  </span>
                </th>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{b.runs}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{b.ballsFaced}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{b.fours}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{b.sixes}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                  <Rate value={b.strikeRate} />
                </td>
              </tr>
            ))}
            <tr className="border-t border-line bg-raised/60">
              <th scope="row" className="px-4 py-2 text-left text-xs font-medium text-ink-muted">
                Extras
              </th>
              <td colSpan={5} className="px-3 py-2 text-right text-xs text-ink-muted">
                {i.extras.total} (b {i.extras.byes}, lb {i.extras.legbyes}, w {i.extras.wides}, nb{' '}
                {i.extras.noballs})
              </td>
            </tr>
            <tr className="bg-raised/60 font-semibold">
              <th scope="row" className="px-4 py-2 text-left">
                Total
              </th>
              <td colSpan={5} className="px-3 py-2 text-right tabular-nums">
                {i.runs}/{i.wickets} ({i.overs} ov, RR <Rate value={i.runRate} />)
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="scroll-x border-t border-line">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{i.bowlingTeam.name} bowling</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-ink-muted">
                Bowler
              </th>
              {['O', 'M', 'R', 'W', 'Econ'].map((h) => (
                <th
                  key={h}
                  scope="col"
                  className="px-3 py-2 text-right text-xs font-medium text-ink-muted"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {i.bowling.map((b) => (
              <tr key={b.player.id} className="border-b border-line/60 last:border-0">
                <th scope="row" className="px-4 py-2 text-left font-normal">
                  <Link
                    href={`/players/${b.player.id}`}
                    className="font-medium text-ink hover:underline underline-offset-2"
                  >
                    {b.player.fullName}
                  </Link>
                </th>
                <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{b.overs}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{b.maidens}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                  {b.runsConceded}
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{b.wickets}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                  <Rate value={b.economy} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {i.fallOfWickets.length > 0 && (
        <div className="border-t border-line px-4 py-3">
          <h4 className="mb-1.5 text-micro font-medium uppercase tracking-wider text-ink-faint">
            Fall of wickets
          </h4>
          <p className="text-xs leading-relaxed text-ink-muted">
            {i.fallOfWickets.map((f, idx) => (
              <span key={f.wicketNumber}>
                {idx > 0 && ' · '}
                <span className="font-medium text-ink">
                  {f.teamScore ?? '?'}-{f.wicketNumber}
                </span>{' '}
                {f.playerOut.shortName}
                {f.overs !== null && ` (${f.overs})`}
              </span>
            ))}
          </p>
        </div>
      )}

      {topPartnership !== undefined && (
        <div className="border-t border-line px-4 py-3">
          <h4 className="mb-1.5 text-micro font-medium uppercase tracking-wider text-ink-faint">
            Best partnership
          </h4>
          <p className="text-sm">
            <span className="font-semibold">{topPartnership.runs}</span>
            <span className="text-ink-muted"> ({topPartnership.balls} balls) — </span>
            {topPartnership.playerA.shortName} &amp; {topPartnership.playerB.shortName}
            <span className="text-ink-faint">
              {' '}
              for the {ordinal(topPartnership.wicketNumber)} wicket
            </span>
          </p>
        </div>
      )}
    </Card>
  );
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

export { TeamBadge };
