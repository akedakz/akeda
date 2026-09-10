type Source = { value: number; weight: number; available: boolean };

export function calculateOverallProgress(sources: Source[]) {
  const available = sources.filter((source) => source.available);
  const weight = available.reduce((sum, source) => sum + source.weight, 0);
  if (!weight) return { percent: 0, hasData: false };
  return {
    percent: Math.round(available.reduce((sum, source) => sum + source.value * source.weight, 0) / weight),
    hasData: true,
  };
}
