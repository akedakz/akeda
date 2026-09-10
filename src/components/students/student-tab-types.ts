export const studentTabs = ["student", "lessons", "progress", "materials", "tests", "trainers", "results"] as const;

export type StudentTab = (typeof studentTabs)[number];

export function parseStudentTab(value: string | string[] | undefined): StudentTab {
  const candidate = Array.isArray(value) ? value[0] : value;
  return studentTabs.includes(candidate as StudentTab) ? (candidate as StudentTab) : "student";
}
