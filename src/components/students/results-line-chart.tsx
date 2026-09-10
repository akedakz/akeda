import type { ResultsChartPoint } from "./student-results-types";

function roundSvgCoordinate(value: number): number {
  return Number(value.toFixed(3));
}

export default function ResultsLineChart({
  title,
  points,
  maximum,
  suffix,
}: {
  title: string;
  points: ResultsChartPoint[];
  maximum: number;
  suffix: string;
}) {
  if (points.length < 2) {
    return (
      <div>
        <h3>{title}</h3>
        <p>Недостаточно данных для графика.</p>
      </div>
    );
  }

  const width = 320;
  const height = 112;
  const inset = 14;
  const coordinates = points.map((point, index) => ({
    ...point,
    x: roundSvgCoordinate(
      inset + index * ((width - inset * 2) / (points.length - 1)),
    ),
    y: roundSvgCoordinate(
      height -
        inset -
        (Math.max(0, Math.min(maximum, point.value)) / maximum) *
          (height - inset * 2),
    ),
  }));

  return (
    <div>
      <h3>{title}</h3>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${title}: ${points
          .map(
            (point) =>
              `${point.label} — ${Math.round(point.value)}${suffix}`,
          )
          .join(", ")}`}
      >
        <path
          d={`M ${inset} ${height - inset} H ${width - inset}`}
          className="chartAxis"
        />
        <polyline
          points={coordinates
            .map((point) => `${point.x},${point.y}`)
            .join(" ")}
          className="chartLine"
        />
        {coordinates.map((point) => (
          <circle
            key={point.id}
            cx={point.x}
            cy={point.y}
            r="4"
            tabIndex={0}
            aria-label={`${point.label}: ${Math.round(point.value)}${suffix}`}
          >
            <title>
              {point.label}: {Math.round(point.value)}
              {suffix}
            </title>
          </circle>
        ))}
      </svg>
    </div>
  );
}
