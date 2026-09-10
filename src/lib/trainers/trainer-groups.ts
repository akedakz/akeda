import { compareNaturalNames } from "@/lib/sorting/natural-name";

export type TrainerGroupType = "QUICK_PROBLEMS" | "THEORY";
export type TrainerGroup = { id: string; trainerType: TrainerGroupType; title: string; sortOrder: number };
export type GroupedTrainerItems<T> = { id: string | null; title: string; items: T[] };

export function groupTrainerItems<T extends { groupId: string | null; title: string }>(groups: TrainerGroup[], items: T[], includeEmpty: boolean): GroupedTrainerItems<T>[] {
  const sorted = (values: T[]) => [...values].sort((left, right) => compareNaturalNames(left.title, stableItemId(left), right.title, stableItemId(right)));
  const orderedGroups = [...groups].sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));
  const buckets = orderedGroups.map((group) => ({ id: group.id, title: group.title, items: sorted(items.filter((item) => item.groupId === group.id)) }));
  const ungrouped = { id: null, title: "Без темы", items: sorted(items.filter((item) => !item.groupId || !groups.some((group) => group.id === item.groupId))) };
  return [...(includeEmpty ? buckets : buckets.filter((group) => group.items.length)), ...(includeEmpty || ungrouped.items.length ? [ungrouped] : [])];
}

function stableItemId(item: object) {
  const value = item as Record<string, unknown>;
  return String(value.id ?? value.trainerId ?? value.sourceTrainerId ?? value.assignmentId ?? value.completionId ?? "");
}
