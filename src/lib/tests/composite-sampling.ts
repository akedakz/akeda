export type SamplingSource = { id: string; title: string; questionCount: number };

export function balancedQuestionAllocation(sources: SamplingSource[], limit: number) {
  const allocation = new Map(sources.map((source) => [source.id, 0]));
  let remaining = Math.min(Math.max(0, limit), sources.reduce((sum, source) => sum + source.questionCount, 0));
  while (remaining > 0) {
    const available = sources.filter((source) => (allocation.get(source.id) ?? 0) < source.questionCount);
    if (!available.length) break;
    const minimum = Math.min(...available.map((source) => allocation.get(source.id) ?? 0));
    const tier = available.filter((source) => (allocation.get(source.id) ?? 0) === minimum);
    for (const source of tier) {
      if (!remaining) break;
      allocation.set(source.id, (allocation.get(source.id) ?? 0) + 1);
      remaining -= 1;
    }
  }
  return sources.map((source) => ({ ...source, count: allocation.get(source.id) ?? 0 }));
}
