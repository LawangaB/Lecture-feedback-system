import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { formatPercent } from '@/lib/utils';
import type { PollResults } from '@/types/api';

const COLORS = ['#4f46e5', '#7c3aed', '#0891b2', '#059669', '#d97706', '#db2777', '#475569', '#65a30d', '#dc2626', '#0d9488'];

/** Real aggregate data only. A text table accompanies the chart so the information is not chart-only. */
export function PollResultsChart({ results, highlightOptionIds = [] }: { results: PollResults; highlightOptionIds?: string[] }) {
  const rows = results.rating
    ? results.rating.distribution.map((d) => ({ id: String(d.value), label: String(d.value), count: d.count, pct: results.totalResponses ? Math.round((d.count / results.totalResponses) * 1000) / 10 : 0 }))
    : results.options.map((o) => ({ id: o.id, label: o.label, count: o.count, pct: o.percentOfRespondents }));
  const height = Math.max(160, rows.length * 44 + 24);
  const summary = rows.map((r) => `${r.label}: ${r.count} (${r.pct}%)`).join('; ');

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
        <span><strong className="tabular text-lg">{results.totalResponses}</strong> <span className="text-muted-foreground">{results.totalResponses === 1 ? 'response' : 'responses'}</span></span>
        <span className="text-muted-foreground tabular">
          {results.joinedParticipants > 0 ? `${formatPercent(results.responseRate)} of ${results.joinedParticipants} joined` : 'No one has joined yet'}
        </span>
        {results.rating?.average != null && <span className="tabular text-muted-foreground">Average <strong className="text-foreground">{results.rating.average}</strong> / {results.rating.max}</span>}
      </div>
      <div role="img" aria-label={`Bar chart of results. ${summary || 'No responses yet.'}`} style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ left: 0, right: 56, top: 4, bottom: 4 }}>
            <CartesianGrid horizontal={false} stroke="var(--color-border)" />
            <XAxis type="number" allowDecimals={false} hide />
            <YAxis type="category" dataKey="label" width={results.rating ? 28 : 120} tick={{ fill: 'var(--color-foreground)', fontSize: 13 }} tickLine={false} axisLine={false} />
            <Bar dataKey="count" radius={[0, 6, 6, 0]} isAnimationActive={false} barSize={26}>
              {rows.map((r, i) => <Cell key={r.id} fill={COLORS[i % COLORS.length]} stroke={highlightOptionIds.includes(r.id) ? 'var(--color-foreground)' : undefined} strokeWidth={highlightOptionIds.includes(r.id) ? 2 : 0} />)}
              <LabelList dataKey="count" position="right" fill="var(--color-foreground)" fontSize={13} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">View as table</summary>
        <table className="mt-2 w-full text-left">
          <caption className="sr-only">Poll results</caption>
          <thead><tr><th scope="col" className="py-1 pr-4 font-medium">Answer</th><th scope="col" className="py-1 pr-4 font-medium">Responses</th><th scope="col" className="py-1 font-medium">Share of respondents</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><th scope="row" className="py-1 pr-4 text-left font-normal">{r.label}</th><td className="tabular py-1 pr-4">{r.count}</td><td className="tabular py-1">{r.pct}%</td></tr>)}</tbody>
        </table>
      </details>
    </div>
  );
}
