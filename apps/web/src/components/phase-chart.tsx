'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { ChartFrame, DataTable } from './chart-frame';
import { Rate } from './primitives';

/**
 * Phase splits.
 *
 * The job is comparing one measure across three ordered, discrete buckets, so
 * this is a bar chart — not the radar a "phase profile" invites. A radar
 * distorts area, has no meaningful axis, and makes three values harder to
 * compare than three bars do.
 *
 * Batting and bowling are two different measures, so they get **two charts**
 * rather than one with two y-axes.
 */

const PHASE_LABEL: Record<string, string> = {
  powerplay: 'Powerplay (1–6)',
  middle: 'Middle (7–15)',
  death: 'Death (16–20)',
};
const ORDER = ['powerplay', 'middle', 'death'];

interface Split {
  phase: string;
  discipline: string;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  dots: number;
  wickets: number;
  strikeRate: number | null;
  economy: number | null;
  dotPercentage: number | null;
}

export function PhaseChart({ data }: { data: Split[] }) {
  const batting = ORDER.map((p) => data.find((d) => d.phase === p && d.discipline === 'batting'))
    .filter((d): d is Split => d !== undefined)
    .filter((d) => d.balls > 0);
  const bowling = ORDER.map((p) => data.find((d) => d.phase === p && d.discipline === 'bowling'))
    .filter((d): d is Split => d !== undefined)
    .filter((d) => d.balls > 0);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {batting.length > 0 && (
        <PhaseBars
          title="Batting by phase"
          description="Strike rate in each phase of the innings."
          rows={batting}
          valueKey="strikeRate"
          valueLabel="Strike rate"
          color="rgb(var(--series-1))"
          tableHeaders={['Phase', 'Runs', 'Balls', '4s', '6s', 'SR']}
          renderRow={(d) => (
            <>
              <td className="px-4 py-1.5 text-right tabular-nums">{d.runs}</td>
              <td className="px-4 py-1.5 text-right tabular-nums text-ink-muted">{d.balls}</td>
              <td className="px-4 py-1.5 text-right tabular-nums text-ink-muted">{d.fours}</td>
              <td className="px-4 py-1.5 text-right tabular-nums text-ink-muted">{d.sixes}</td>
              <td className="px-4 py-1.5 text-right font-medium tabular-nums">
                <Rate value={d.strikeRate} />
              </td>
            </>
          )}
        />
      )}

      {bowling.length > 0 && (
        <PhaseBars
          title="Bowling by phase"
          description="Economy rate in each phase. Lower is better."
          rows={bowling}
          valueKey="economy"
          valueLabel="Economy"
          color="rgb(var(--series-2))"
          tableHeaders={['Phase', 'Balls', 'Runs', 'Wkts', 'Dot %', 'Econ']}
          renderRow={(d) => (
            <>
              <td className="px-4 py-1.5 text-right tabular-nums text-ink-muted">{d.balls}</td>
              <td className="px-4 py-1.5 text-right tabular-nums text-ink-muted">{d.runs}</td>
              <td className="px-4 py-1.5 text-right font-medium tabular-nums">{d.wickets}</td>
              <td className="px-4 py-1.5 text-right tabular-nums text-ink-muted">
                <Rate value={d.dotPercentage} digits={1} />
              </td>
              <td className="px-4 py-1.5 text-right font-medium tabular-nums">
                <Rate value={d.economy} />
              </td>
            </>
          )}
        />
      )}
    </div>
  );
}

function PhaseBars({
  title,
  description,
  rows,
  valueKey,
  valueLabel,
  color,
  tableHeaders,
  renderRow,
}: {
  title: string;
  description: string;
  rows: Split[];
  valueKey: 'strikeRate' | 'economy';
  valueLabel: string;
  color: string;
  tableHeaders: string[];
  renderRow: (d: Split) => React.ReactNode;
}) {
  const chartData = rows.map((d) => ({
    phase: PHASE_LABEL[d.phase] ?? d.phase,
    value: d[valueKey] ?? 0,
  }));

  return (
    <ChartFrame
      title={title}
      description={description}
      isEmpty={rows.length === 0}
      emptyTitle="No deliveries in this discipline"
      table={
        <DataTable caption={title} headers={tableHeaders}>
          {rows.map((d) => (
            <tr key={d.phase} className="border-b border-line/60 last:border-0">
              <th scope="row" className="px-4 py-1.5 text-left font-normal text-ink-muted">
                {PHASE_LABEL[d.phase] ?? d.phase}
              </th>
              {renderRow(d)}
            </tr>
          ))}
        </DataTable>
      }
    >
      <ResponsiveContainer width="100%" height={220}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 4, right: 40, bottom: 4, left: 4 }}
        >
          <CartesianGrid stroke="rgb(var(--line))" strokeDasharray="2 4" horizontal={false} />
          <XAxis
            type="number"
            stroke="rgb(var(--ink-faint))"
            tick={{ fontSize: 11, fill: 'rgb(var(--ink-faint))' }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            type="category"
            dataKey="phase"
            stroke="rgb(var(--ink-faint))"
            tick={{ fontSize: 11, fill: 'rgb(var(--ink-muted))' }}
            tickLine={false}
            axisLine={false}
            width={110}
          />
          <Tooltip
            cursor={{ fill: 'rgb(var(--ink) / 0.04)' }}
            content={({ active, payload, label }) =>
              active === true && payload !== undefined && payload.length > 0 ? (
                <div className="rounded-md border border-line bg-raised px-2.5 py-2 shadow-card">
                  <p className="text-xs font-medium text-ink">{String(label)}</p>
                  <p className="text-xs text-ink-muted">
                    {valueLabel}:{' '}
                    <span className="font-medium text-ink">
                      {Number(payload[0]?.value ?? 0).toFixed(2)}
                    </span>
                  </p>
                </div>
              ) : null
            }
          />
          {/* Three bars, one measure: the value is direct-labelled rather than
              read off an axis, which is what makes the axis recessive. */}
          <Bar dataKey="value" fill={color} radius={[0, 4, 4, 0]} isAnimationActive={false}>
            <LabelList
              dataKey="value"
              position="right"
              className="fill-ink"
              style={{ fontSize: 11, fontWeight: 600 }}
              formatter={(v: number) => v.toFixed(2)}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
