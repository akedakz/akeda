export type PendingGuard = { current: boolean };

export function tryAcquirePending(guard: PendingGuard) {
  if (guard.current) return false;
  guard.current = true;
  return true;
}

export function releasePending(guard: PendingGuard) {
  guard.current = false;
}
