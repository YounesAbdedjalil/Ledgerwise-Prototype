export type SourceFreshness = "fresh" | "aging" | "stale" | "unknown";

const DAY_MS = 24 * 60 * 60 * 1000;

export function getSourceFreshness(
  retrievedAt: string,
  now: Date = new Date(),
): SourceFreshness {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(retrievedAt)) return "unknown";
  const retrieved = new Date(`${retrievedAt}T00:00:00.000Z`);
  if (Number.isNaN(retrieved.getTime()) || retrieved.toISOString().slice(0, 10) !== retrievedAt) {
    return "unknown";
  }
  const ageDays = Math.floor((now.getTime() - retrieved.getTime()) / DAY_MS);
  if (ageDays < 0) return "unknown";
  if (ageDays <= 90) return "fresh";
  if (ageDays <= 180) return "aging";
  return "stale";
}
