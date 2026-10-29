import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export interface ParticipationPoint { name: string; rate: number; full: string }

export function ParticipationChart({ data }: { data: ParticipationPoint[] }) {
  return (
    <>
      <div role="img" aria-label={`Participation rates: ${data.map((t) => `${t.full} ${t.rate}%`).join(', ')}`} className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ left: -20, right: 4, top: 4 }}>
            <CartesianGrid vertical={false} stroke="var(--color-border)" />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} tickLine={false} axisLine={false} interval={0} />
            <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} tickLine={false} axisLine={false} />
            <Tooltip formatter={(v) => `${v}%`} labelFormatter={(_, p) => p?.[0]?.payload?.full ?? ''} />
            <Bar dataKey="rate" fill="var(--color-primary)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ul className="sr-only">{data.map((t) => <li key={t.full}>{t.full}: {t.rate}%</li>)}</ul>
    </>
  );
}
