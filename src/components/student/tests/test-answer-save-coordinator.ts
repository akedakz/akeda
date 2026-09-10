const pendingByAttempt = new Map<string, Set<Promise<unknown>>>();

export function trackAttemptSave(attemptId: string, save: Promise<unknown>) {
  const pending = pendingByAttempt.get(attemptId) ?? new Set<Promise<unknown>>();
  pending.add(save);
  pendingByAttempt.set(attemptId, pending);
  const cleanup = () => {
    pending.delete(save);
    if (pending.size === 0) pendingByAttempt.delete(attemptId);
  };
  void save.then(cleanup, cleanup);
  return save;
}

export async function waitForAttemptSaves(attemptId: string) {
  while (pendingByAttempt.get(attemptId)?.size) {
    await Promise.allSettled([...pendingByAttempt.get(attemptId)!]);
  }
}
