/**
 * Per-process scan bookkeeping.
 *
 * When each tracker was last scanned is deliberately not a database column: it
 * is operational state, not collected data, and writing it on every scan would
 * mean a database write per tick.
 */
const lastScanAt = new Map<string, number>();

export function markScanned(trackerId: string) {
  lastScanAt.set(trackerId, Date.now());
}

export function lastScannedAt(trackerId: string): number {
  return lastScanAt.get(trackerId) || 0;
}

/** The tracker that has gone longest without a scan, or null. */
export function stalestTracker<T extends { id: string }>(trackers: T[]): T | null {
  if (trackers.length === 0) return null;
  return [...trackers].sort((a, b) => lastScannedAt(a.id) - lastScannedAt(b.id))[0];
}
