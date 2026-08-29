'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { ChartFrame, DataTable } from './chart-frame';

/**
 * Match charts.
 *
 * Two forms, each chosen for its job:
 *
 *  - **Worm** — cumulative score against balls bowled. The job is
 *    change-over-time for two comparable series, so: a line chart, one line per
 *    innings, wickets marked as points on the line rather than as a second
 *    encoding.
 *  - **Manhattan** — runs in each over. The job is magnitude across a discrete
 *    ordered dimension, so: bars, one per over.
 *
 * Both use the validated two-slot categorical palette (blue, orange) read from
 * CSS variables, so they follow the theme rather than hard-coding hex. Colour
 * follows the *innings*, never its rank, so a filter can never repaint them.
 *
 * There is deliberately **no second y-axis** anywhere. Runs and wickets are
 * different scales; wickets are encoded as marks on the runs geometry, not as a
 * dual axis.
 */

const SERIES = ['rgb(var(--series-1))', 'rgb(var(--series-2))'] as const;
const AXIS = 'rgb(var(--ink-faint))';
const GRID = 'rgb(var(--line))';

interface WormPoint {
  inningsNo: number;
  ballNumber: number;
  overs: string;
  runs: number;
  wickets: number;
}

interface TeamLabel {
  inningsNo: number;
  label: string;
}

function TooltipCard({
  active,
  payload,
  label,
  suffix,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string }[];
  label?: string | number;
  suffix: string;
}) {
  if (active !== true || payload === undefined || payload.length === 0) return null;
  return (
    <div className="rounded-md border border-line bg-raised px-2.5 py-2 shadow-card">
      <p className="mb-1 text-xs font-medium text-ink">
        {suffix} {label}
      </p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-1.5 text-xs text-ink-muted">
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: p.color }}
          />
          {p.name}: <span className="font-medium text-ink">{p.value}</span>
        </p>
      ))}
    </div>
  );
}

export function WormChart({
  data,
  teams,
}: {
  data: WormPoint[];
  teams: TeamLabel[];
}) {
  const innings = [...new Set(data.map((d) => d.inningsNo))].sort((a, b) => a - b);
  const labelFor = (n: number) => teams.find((t) => t.inningsNo === n)?.label ?? `Innings ${n}`;

  // One row per ball number, one column per innings, so the two lines share an
  // x-axis without either being resampled.
  const maxBall = Math.max(0, ...data.map((d) => d.ballNumber));
  const rows = Array.from({ length: maxBall }, (_, i) => {
    const ball = i + 1;
    const row: Record<string, number | string | null> = { ball };
    for (const n of innings) {
      row[`i${n}`] = data.find((d) => d.inningsNo === n && d.ballNumber === ball)?.runs ?? null;
    }
    return row;
  });

  // Wickets, as points on the line they belong to.
  const wicketMarks = innings.flatMap((n) => {
    const series = data.filter((d) => d.inningsNo === n);
    const marks: { ball: number; runs: number; innings: number }[] = [];
    let seen = 0;
    for (const p of series) {
      if (p.wickets > seen) {
        seen = p.wickets;
        marks.push({ ball: p.ballNumber, runs: p.runs, innings: n });
      }
    }
    return marks;
  });

  return (
    <ChartFrame
      title="Run progression"
      description="Cumulative score by ball. Dots mark wickets."
      isEmpty={data.length === 0}
      emptyTitle="No ball-by-ball data"
      emptyDescription="This match has no delivery-level detail recorded."
      legend={innings.map((n, i) => ({
        label: labelFor(n),
        color: SERIES[i % SERIES.length]!,
      }))}
      table={
        <DataTable
          caption="Cumulative runs and wickets by ball for each innings"
          headers={['Ball', 'Overs', ...innings.map((n) => labelFor(n))]}
        >
          {rows
            .filter((_, i) => (i + 1) % 6 === 0)
            .map((r) => (
              <tr key={String(r['ball'])} className="border-b border-line/60 last:border-0">
                <td className="px-4 py-1.5 text-ink-muted">{r['ball']}</td>
                <td className="px-4 py-1.5 text-right text-ink-muted">
                  {data.find((d) => d.ballNumber === r['ball'])?.overs ?? '—'}
                </td>
                {innings.map((n) => (
                  <td key={n} className="px-4 py-1.5 text-right font-medium text-ink">
                    {r[`i${n}`] ?? '—'}
                  </td>
                ))}
              </tr>
            ))}
        </DataTable>
      }
    >
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="ball"
            stroke={AXIS}
            tick={{ fontSize: 11, fill: AXIS }}
            tickLine={false}
            axisLine={{ stroke: GRID }}
            // Label in overs, which is how the score is actually read.
            tickFormatter={(b: number) => String(Math.floor(b / 6))}
            label={{ value: 'Overs', position: 'insideBottom', offset: -2, fontSize: 11, fill: AXIS }}
          />
          <YAxis
            stroke={AXIS}
            tick={{ fontSize: 11, fill: AXIS }}
            tickLine={false}
            axisLine={false}
            width={44}
          />
          <Tooltip
            content={<TooltipCard suffix="Ball" />}
            cursor={{ stroke: GRID, strokeWidth: 1 }}
          />
          {innings.map((n, i) => (
            <Line
              key={n}
              type="monotone"
              dataKey={`i${n}`}
              name={labelFor(n)}
              stroke={SERIES[i % SERIES.length]}
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          ))}
          {wicketMarks.map((w) => (
            <ReferenceDot
              key={`${w.innings}-${w.ball}`}
              x={w.ball}
              y={w.runs}
              yAxisId={0}
              r={3.5}
              fill={SERIES[innings.indexOf(w.innings) % SERIES.length]}
              // A 2px surface ring keeps overlapping marks legible.
              stroke="rgb(var(--surface))"
              strokeWidth={2}
              isFront
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

interface ManhattanBarData {
  inningsNo: number;
  over: number;
  runs: number;
  wickets: number;
}

export function ManhattanChart({
  data,
  teams,
}: {
  data: ManhattanBarData[];
  teams: TeamLabel[];
}) {
  const innings = [...new Set(data.map((d) => d.inningsNo))].sort((a, b) => a - b);
  const labelFor = (n: number) => teams.find((t) => t.inningsNo === n)?.label ?? `Innings ${n}`;

  const overs = [...new Set(data.map((d) => d.over))].sort((a, b) => a - b);
  const rows = overs.map((over) => {
    const row: Record<string, number | null> = { over };
    for (const n of innings) {
      const hit = data.find((d) => d.inningsNo === n && d.over === over);
      row[`i${n}`] = hit?.runs ?? null;
      row[`w${n}`] = hit?.wickets ?? 0;
    }
    return row;
  });

  return (
    <ChartFrame
      title="Runs per over"
      description="Bars darken where wickets fell in that over."
      isEmpty={data.length === 0}
      emptyTitle="No over-by-over data"
      legend={innings.map((n, i) => ({
        label: labelFor(n),
        color: SERIES[i % SERIES.length]!,
      }))}
      table={
        <DataTable
          caption="Runs and wickets in each over, by innings"
          headers={[
            'Over',
            ...innings.flatMap((n) => [`${labelFor(n)} runs`, `${labelFor(n)} wkts`]),
          ]}
        >
          {rows.map((r) => (
            <tr key={String(r['over'])} className="border-b border-line/60 last:border-0">
              <td className="px-4 py-1.5 text-ink-muted">{r['over']}</td>
              {innings.flatMap((n) => [
                <td key={`r${n}`} className="px-4 py-1.5 text-right font-medium text-ink">
                  {r[`i${n}`] ?? '—'}
                </td>,
                <td key={`w${n}`} className="px-4 py-1.5 text-right text-ink-muted">
                  {r[`w${n}`] ?? 0}
                </td>,
              ])}
            </tr>
          ))}
        </DataTable>
      }
    >
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: -12 }} barGap={2}>
          <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="over"
            stroke={AXIS}
            tick={{ fontSize: 11, fill: AXIS }}
            tickLine={false}
            axisLine={{ stroke: GRID }}
            label={{ value: 'Over', position: 'insideBottom', offset: -2, fontSize: 11, fill: AXIS }}
          />
          <YAxis
            stroke={AXIS}
            tick={{ fontSize: 11, fill: AXIS }}
            tickLine={false}
            axisLine={false}
            width={44}
          />
          <Tooltip
            content={<TooltipCard suffix="Over" />}
            cursor={{ fill: 'rgb(var(--ink) / 0.04)' }}
          />
          {innings.map((n, i) => (
            <Bar
              key={n}
              dataKey={`i${n}`}
              name={labelFor(n)}
              fill={SERIES[i % SERIES.length]}
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            >
              {rows.map((r) => (
                <Cell
                  key={`${n}-${r['over']}`}
                  // Wicket overs are darkened rather than recoloured, so the
                  // series identity survives the second encoding.
                  fillOpacity={(r[`w${n}`] ?? 0) > 0 ? 1 : 0.62}
                />
              ))}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
