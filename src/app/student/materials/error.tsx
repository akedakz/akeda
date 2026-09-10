"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return <main style={{ maxWidth: 980, margin: "0 auto" }}><h1>Материалы</h1><p>Не удалось загрузить материалы.</p><button onClick={reset}>Попробовать ещё раз</button></main>;
}
