import type { LessonStatusOverride } from "@/components/students/student-lesson-types";

type Lesson = { statusOverride: LessonStatusOverride | null };

export function calculateAttendanceStats(lessons: Lesson[]) {
  const considered = lessons.filter((lesson) => !lesson.statusOverride?.startsWith("CANCELLED_"));
  const attended = considered.filter((lesson) => lesson.statusOverride === null).length;
  return {
    attended,
    considered: considered.length,
    percent: considered.length ? attended / considered.length * 100 : null,
  };
}
