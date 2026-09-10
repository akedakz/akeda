export default function ResultsDonut({ percent }: { percent: number | null }) {
  const value = percent ?? 0;
  return <div role="img" aria-label={percent === null ? "Нет данных о посещаемости" : `Посещаемость ${Math.round(value)} процентов`} style={{ "--result-percent": value } as React.CSSProperties}>
    <svg viewBox="0 0 42 42" aria-hidden><circle cx="21" cy="21" r="16"/><circle cx="21" cy="21" r="16" pathLength="100"/></svg>
    <strong>{percent === null ? "—" : `${Math.round(value)}%`}</strong>
  </div>;
}
