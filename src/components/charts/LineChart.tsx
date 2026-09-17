import { useState } from "react";

export interface LineSeries {
  id: string;
  label: string;
  color: string;
  points: { x: number; y: number }[]; // y em fração 0..1 (probabilidade)
}

export function LineChart({
  series,
  height = 240,
  yFormat = (v: number) => `${Math.round(v * 100)}%`,
  xLabel = "Turno",
}: {
  series: LineSeries[];
  height?: number;
  yFormat?: (v: number) => string;
  xLabel?: string;
}) {
  const [hoverX, setHoverX] = useState<number | null>(null);
  const width = 560;
  const padding = { top: 16, right: 16, bottom: 28, left: 40 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  const allX = series.flatMap((s) => s.points.map((p) => p.x));
  const minX = allX.length ? Math.min(...allX) : 0;
  const maxX = allX.length ? Math.max(...allX) : 1;
  const spanX = Math.max(1, maxX - minX);

  const sx = (x: number) => padding.left + ((x - minX) / spanX) * innerW;
  const sy = (y: number) => padding.top + (1 - y) * innerH;

  const gridY = [0, 0.25, 0.5, 0.75, 1];

  const closestIdx =
    hoverX !== null
      ? Math.round(((hoverX - padding.left) / innerW) * spanX + minX)
      : null;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      role="img"
      aria-label="Gráfico de probabilidade por turno"
      onMouseMove={(e) => {
        const rect = (e.target as SVGElement).ownerSVGElement!.getBoundingClientRect();
        const scale = width / rect.width;
        setHoverX((e.clientX - rect.left) * scale);
      }}
      onMouseLeave={() => setHoverX(null)}
    >
      {gridY.map((g) => (
        <g key={g}>
          <line
            x1={padding.left}
            x2={width - padding.right}
            y1={sy(g)}
            y2={sy(g)}
            stroke="var(--gridline)"
            strokeWidth={1}
          />
          <text x={padding.left - 6} y={sy(g) + 3} textAnchor="end" fontSize={10} fill="var(--text-muted)">
            {yFormat(g)}
          </text>
        </g>
      ))}
      <line
        x1={padding.left}
        y1={height - padding.bottom}
        x2={width - padding.right}
        y2={height - padding.bottom}
        stroke="var(--baseline)"
        strokeWidth={1}
      />
      {series.map((s) => (
        <polyline
          key={s.id}
          fill="none"
          stroke={s.color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          points={s.points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(" ")}
        />
      ))}
      {[minX, Math.round((minX + maxX) / 2), maxX].map((t) => (
        <text
          key={t}
          x={sx(t)}
          y={height - padding.bottom + 16}
          textAnchor="middle"
          fontSize={10}
          fill="var(--text-muted)"
        >
          {xLabel} {t}
        </text>
      ))}
      {closestIdx !== null && (
        <g>
          <line
            x1={sx(closestIdx)}
            x2={sx(closestIdx)}
            y1={padding.top}
            y2={height - padding.bottom}
            stroke="var(--text-muted)"
            strokeWidth={1}
            strokeDasharray="3,3"
          />
          {series.map((s) => {
            const pt = s.points.find((p) => p.x === closestIdx);
            if (!pt) return null;
            return (
              <circle key={s.id} cx={sx(pt.x)} cy={sy(pt.y)} r={4} fill={s.color} />
            );
          })}
          <rect
            x={Math.min(width - 150, sx(closestIdx) + 8)}
            y={padding.top}
            width={140}
            height={16 * series.length + 20}
            rx={6}
            fill="var(--surface-1)"
            stroke="var(--border)"
          />
          <text
            x={Math.min(width - 142, sx(closestIdx) + 16)}
            y={padding.top + 14}
            fontSize={11}
            fontWeight={700}
            fill="var(--text-primary)"
          >
            {xLabel} {closestIdx}
          </text>
          {series.map((s, i) => {
            const pt = s.points.find((p) => p.x === closestIdx);
            return (
              <text
                key={s.id}
                x={Math.min(width - 142, sx(closestIdx) + 16)}
                y={padding.top + 30 + i * 16}
                fontSize={10.5}
                fill="var(--text-secondary)"
              >
                {s.label}: {pt ? yFormat(pt.y) : "—"}
              </text>
            );
          })}
        </g>
      )}
    </svg>
  );
}

export function Legend({ series }: { series: { id: string; label: string; color: string }[] }) {
  if (series.length < 2) return null;
  return (
    <div className="legend">
      {series.map((s) => (
        <span className="legend-item" key={s.id}>
          <span className="legend-dot" style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}
