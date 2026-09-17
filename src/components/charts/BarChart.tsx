import { useState } from "react";

export interface BarDatum {
  label: string;
  value: number;
}

export function BarChart({
  data,
  color = "var(--series-1)",
  height = 200,
  valueSuffix = "",
}: {
  data: BarDatum[];
  color?: string;
  height?: number;
  valueSuffix?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 560;
  const padding = { top: 16, right: 12, bottom: 28, left: 12 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const max = Math.max(1, ...data.map((d) => d.value));
  const barGap = 8;
  const barWidth = data.length > 0 ? innerW / data.length - barGap : 0;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      role="img"
      aria-label="Gráfico de barras"
      onMouseLeave={() => setHover(null)}
    >
      <line
        x1={padding.left}
        y1={height - padding.bottom}
        x2={width - padding.right}
        y2={height - padding.bottom}
        stroke="var(--baseline)"
        strokeWidth={1}
      />
      {data.map((d, i) => {
        const x = padding.left + i * (barWidth + barGap) + barGap / 2;
        const h = max > 0 ? (d.value / max) * innerH : 0;
        const y = height - padding.bottom - h;
        const isHover = hover === i;
        return (
          <g key={d.label}>
            <rect
              x={x}
              y={h > 0 ? y : height - padding.bottom - 2}
              width={Math.max(2, barWidth)}
              height={Math.max(2, h)}
              rx={4}
              fill={color}
              opacity={isHover ? 1 : 0.85}
              onMouseEnter={() => setHover(i)}
            />
            <text
              x={x + barWidth / 2}
              y={height - padding.bottom + 16}
              textAnchor="middle"
              fontSize={11}
              fill="var(--text-muted)"
            >
              {d.label}
            </text>
            {isHover && (
              <text
                x={x + barWidth / 2}
                y={y - 6}
                textAnchor="middle"
                fontSize={11}
                fontWeight={700}
                fill="var(--text-primary)"
              >
                {d.value}
                {valueSuffix}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
