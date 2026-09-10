import StudentMaterialsAdminPanel from "@/components/students/student-materials-admin-panel";
import StudentLessonsPanel from "@/components/students/student-lessons-panel";
import StudentProfilePanel from "@/components/students/student-profile-panel";
import StudentProgramSelector from "@/components/students/student-program-selector";
import StudentTopicsPanel from "@/components/students/student-topics-panel";
import StudentTrainersPanel from "@/components/students/student-trainers-panel";
import FormulaRecallAssignmentsPanel from "@/components/students/formula-recall-assignments-panel";
import StudentMistakesCard from "@/components/students/student-mistakes-card";
import StudentProgressPage from "@/components/student/progress/student-progress-page";
import type { StudentTopic } from "@/components/students/student-topic-types";
import type { HomeworkRecord, LessonStatusOverride, ScheduleSlot, StudentLesson } from "@/components/students/student-lesson-types";
import type { StudentFolderAccessItem, StudentMaterialAccessItem, StudentMaterialViewItem } from "@/components/students/student-material-types";
import type { StudentTab } from "@/components/students/student-tab-types";
import TestAssignmentList from "@/components/students/test-assignment-list";
import type { AssignmentListItem } from "@/components/students/test-assignment-types";
import type { MaterialType } from "@/app/admin/materials/actions";
import { ensureStudentLessons } from "@/lib/lessons/lesson-generation";
import { getLessonStatus } from "@/lib/lessons/lesson-status";
import { formatMaterialViewDate } from "@/lib/materials/material-view-date";
import { loadStudentProgressByStudentId } from "@/lib/progress/student-progress";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadAdminStudentTrainerReadModel } from "@/lib/trainers/admin-student-read-model";

import styles from "./student.module.css";

type Query = Record<string, string | string[] | undefined>;
type StudentProfile = { id: string; full_name: string | null; email: string | null; role: "STUDENT"; created_at: string; student_status: import("@/types/profile").StudentStatus | null; avatar_path: string | null };
type Props = { student: StudentProfile; adminId: string; activeTab: StudentTab; query: Query };
type AssignmentRow = { id: string; title: string; source_test_id: string | null; deadline_at: string | null; created_at: string };
type AssignmentAttemptRow = { id: string; assignment_id: string; started_at: string; submitted_at: string | null; score: number | null; max_score: number | null };
type AttemptAnswerSummaryRow = { attempt_id: string; is_correct: boolean | null };
type FolderAccessRow = { id: string; folder_id: string; created_at: string };
type MaterialAccessRow = { id: string; material_id: string; created_at: string };
type MaterialRow = { id: string; type: MaterialType; title: string; description: string | null; storage_path: string | null; file_size: number | null; external_url: string | null; created_at: string };

export default async function StudentTabContent({ student, adminId, activeTab, query }: Props) {
  switch (activeTab) {
    case "student": return <StudentTab student={student}/>;
    case "lessons": return <LessonsTab studentId={student.id} query={query}/>;
    case "progress": return <TopicsTab studentId={student.id}/>;
    case "materials": return <MaterialsTab studentId={student.id}/>;
    case "tests": return <TestsTab studentId={student.id}/>;
    case "trainers": return <TrainersTab studentId={student.id} adminId={adminId}/>;
    case "results": return <ResultsTab studentId={student.id}/>;
  }
}

async function StudentTab({ student }: { student: StudentProfile }) {
  const admin = createAdminClient();
  const [programsResult, assignedResult] = await Promise.all([
    admin.from("learning_programs").select("id,name,is_active").order("name"),
    admin.from("student_learning_programs").select("program_id").eq("student_id", student.id),
  ]);
  let programs: { id: string; name: string; active: boolean }[] = [];
  let assignedIds: string[] = [];
  if (programsResult.error || assignedResult.error) console.error("Не удалось загрузить программы ученика:", { programs: programsResult.error?.message, assigned: assignedResult.error?.message });
  else {
    programs = programsResult.data.map((program) => ({ id: program.id, name: program.name, active: program.is_active }));
    assignedIds = assignedResult.data.map((item) => item.program_id);
  }
  return <Tab><StudentProfilePanel student={{ id: student.id, fullName: student.full_name ?? "Без имени", email: student.email ?? "", status: student.student_status, createdAt: student.created_at }}/><StudentProgramSelector studentId={student.id} programs={programs} assignedIds={assignedIds}/></Tab>;
}

async function LessonsTab({ studentId, query }: { studentId: string; query: Query }) {
  const admin = createAdminClient();
  const now = new Date();
  const generated = await ensureStudentLessons(admin, studentId, new Date(now.getTime() - 90 * 86400000), new Date(now.getTime() + 30 * 86400000));
  let schedule: ScheduleSlot[] = [], upcoming: StudentLesson[] = [], past: StudentLesson[] = [];
  let hasMore = false;
  let loadError: string | undefined;
  if (generated.error) {
    console.error("Не удалось создать экземпляры уроков:", { code: generated.error.code, message: generated.error.message, details: generated.error.details, hint: generated.error.hint });
    loadError = "Не удалось подготовить уроки ученика.";
  } else {
    const historyRaw = Array.isArray(query.history) ? query.history[0] : query.history;
    const historyPage = Math.min(10, Math.max(1, Number.parseInt(historyRaw ?? "1", 10) || 1));
    const historyLimit = historyPage * 10;
    const [scheduleResult, upcomingResult, pastResult] = await Promise.all([
      admin.from("student_schedule_slots").select("id, weekday, start_time, duration_minutes, valid_from").eq("student_id", studentId).is("valid_until", null).order("weekday").order("start_time"),
      admin.from("student_lessons").select("id, schedule_slot_id, starts_at, ends_at, status_override").eq("student_id", studentId).is("deleted_at", null).gt("ends_at", now.toISOString()).order("starts_at", { ascending: true }).limit(3),
      admin.from("student_lessons").select("id, schedule_slot_id, starts_at, ends_at, status_override").eq("student_id", studentId).is("deleted_at", null).lte("ends_at", now.toISOString()).order("starts_at", { ascending: false }).limit(historyLimit + 1),
    ]);
    const lessonError = scheduleResult.error ?? upcomingResult.error ?? pastResult.error;
    if (lessonError) {
      console.error("Не удалось загрузить расписание или уроки:", { code: lessonError.code, message: lessonError.message, details: lessonError.details, hint: lessonError.hint });
      loadError = "Не удалось загрузить расписание и уроки.";
    } else {
      schedule = (scheduleResult.data ?? []).map((slot) => ({ id: slot.id, weekday: slot.weekday, startTime: slot.start_time, durationMinutes: slot.duration_minutes, validFrom: slot.valid_from }));
      const pastRows = (pastResult.data ?? []).slice(0, historyLimit);
      hasMore = (pastResult.data?.length ?? 0) > historyLimit;
      const allRows = [...(upcomingResult.data ?? []), ...pastRows] as { id: string; schedule_slot_id: string | null; starts_at: string; ends_at: string; status_override: LessonStatusOverride | null }[];
      const homework = new Map<string, HomeworkRecord>();
      if (allRows.length) {
        const homeworkResult = await admin.from("lesson_homework_records").select("lesson_id, title, grade, comment").in("lesson_id", allRows.map((lesson) => lesson.id));
        if (homeworkResult.error) {
          console.error("Не удалось загрузить ДЗ уроков:", { code: homeworkResult.error.code, message: homeworkResult.error.message, details: homeworkResult.error.details, hint: homeworkResult.error.hint });
          loadError = "Не удалось загрузить домашние задания.";
        } else for (const record of homeworkResult.data ?? []) homework.set(record.lesson_id, { title: record.title, grade: record.grade, comment: record.comment });
      }
      const convert = (lesson: typeof allRows[number]): StudentLesson => ({ id: lesson.id, scheduleSlotId: lesson.schedule_slot_id, startsAt: lesson.starts_at, endsAt: lesson.ends_at, statusOverride: lesson.status_override, status: getLessonStatus(lesson.status_override, lesson.ends_at, now), homework: homework.get(lesson.id) ?? null });
      upcoming = (upcomingResult.data ?? []).map((row) => convert(row as typeof allRows[number]));
      past = pastRows.map((row) => convert(row as typeof allRows[number]));
    }
  }
  return <Tab><StudentLessonsPanel studentId={studentId} schedule={schedule} upcoming={upcoming} past={past} hasMore={hasMore} loadError={loadError} isDevelopment={process.env.NODE_ENV === "development"}/></Tab>;
}

async function TopicsTab({ studentId }: { studentId: string }) {
  const admin = createAdminClient();
  const { data, error } = await admin.from("student_topics").select("id, title, sort_order, completed_at").eq("student_id", studentId).order("sort_order");
  if (error) console.error("Не удалось загрузить темы ученика:", { code: error.code, message: error.message, details: error.details, hint: error.hint });
  const topics: StudentTopic[] = (data ?? []).map((topic) => ({ id: topic.id, title: topic.title, sortOrder: topic.sort_order, completedAt: topic.completed_at }));
  return <Tab><StudentTopicsPanel key={topics.map((topic) => `${topic.id}:${topic.completedAt ?? ""}`).join("|")} studentId={studentId} initialTopics={topics}/></Tab>;
}

async function MaterialsTab({ studentId }: { studentId: string }) {
  const admin = createAdminClient();
  const [folderResult, materialResult, viewsResult] = await Promise.all([
    admin.from("student_material_folder_access").select("id, folder_id, created_at").eq("student_id", studentId).order("created_at", { ascending: false }),
    admin.from("student_material_access").select("id, material_id, created_at").eq("student_id", studentId).order("created_at", { ascending: false }),
    admin.from("student_material_views").select("material_item_id, last_opened_at").eq("student_id", studentId),
  ]);
  let folders: StudentFolderAccessItem[] = [], materials: StudentMaterialAccessItem[] = [], viewed: StudentMaterialViewItem[] = [];
  let loadError: string | undefined, viewedLoadError: string | undefined;
  const folderRows = (folderResult.data ?? []) as FolderAccessRow[];
  const accessRows = (materialResult.data ?? []) as MaterialAccessRow[];
  const viewRows = viewsResult.data ?? [];
  const accessMaterialIds = [...new Set(accessRows.map((item) => item.material_id))];
  const accessMaterialIdSet = new Set(accessMaterialIds);
  const viewedOnlyMaterialIds = [...new Set(viewRows.map((item) => item.material_item_id).filter((id) => !accessMaterialIdSet.has(id)))];
  const [foldersResult, materialsResult, viewedTitlesResult] = await Promise.all([
    folderRows.length ? admin.from("material_folders").select("id, name").in("id", folderRows.map((item) => item.folder_id)) : Promise.resolve({ data: [], error: null }),
    accessMaterialIds.length ? admin.from("materials").select("id, type, title, description, storage_path, file_size, external_url, created_at").in("id", accessMaterialIds) : Promise.resolve({ data: [], error: null }),
    viewedOnlyMaterialIds.length ? admin.from("materials").select("id, title").in("id", viewedOnlyMaterialIds) : Promise.resolve({ data: [], error: null }),
  ]);
  const accessError = folderResult.error ?? materialResult.error;
  if (accessError) {
    console.error("Не удалось загрузить доступы к материалам ученика:", { code: accessError.code, message: accessError.message, details: accessError.details, hint: accessError.hint });
    loadError = "Не удалось загрузить материалы ученика.";
  } else {
    const entityError = foldersResult.error ?? materialsResult.error;
    if (entityError) {
      console.error("Не удалось загрузить назначенные материалы или папки:", { code: entityError.code, message: entityError.message });
      loadError = "Не удалось загрузить данные назначенных материалов.";
    } else {
      const folderMap = new Map(((foldersResult.data ?? []) as { id: string; name: string }[]).map((item) => [item.id, item]));
      folders = folderRows.flatMap((access) => { const folder = folderMap.get(access.folder_id); return folder ? [{ accessId: access.id, folderId: folder.id, name: folder.name, createdAt: access.created_at }] : []; });
      const materialMap = new Map(((materialsResult.data ?? []) as MaterialRow[]).map((item) => [item.id, item]));
      materials = accessRows.flatMap((access) => { const item = materialMap.get(access.material_id); return item ? [{ id: item.id, accessId: access.id, materialId: item.id, type: item.type, title: item.title, description: item.description, fileSize: item.file_size, createdAt: item.created_at, grantedAt: access.created_at, openUrl: item.type === "FILE" || item.type === "TEXT" ? `/admin/materials/${item.id}` : item.external_url, external: item.type !== "TEXT" && item.type !== "FILE" }] : []; });
    }
  }
  if (viewsResult.error) {
    console.error("Не удалось загрузить просмотры материалов ученика:", { code: viewsResult.error.code, message: viewsResult.error.message });
    viewedLoadError = "Не удалось загрузить просмотренные материалы.";
  } else if (viewedTitlesResult.error || (materialsResult.error && viewRows.some((row) => accessMaterialIdSet.has(row.material_item_id)))) {
    const titleError = viewedTitlesResult.error ?? materialsResult.error!;
    console.error("Не удалось загрузить названия просмотренных материалов:", { code: titleError.code, message: titleError.message, details: titleError.details, hint: titleError.hint });
    viewedLoadError = "Не удалось загрузить просмотренные материалы.";
  } else {
    const titles = new Map([...(materialsResult.data ?? []), ...(viewedTitlesResult.data ?? [])].map((item) => [item.id, item.title]));
    const collator = new Intl.Collator("ru", { sensitivity: "base", numeric: true });
    viewed = viewRows.flatMap((row) => { const title = titles.get(row.material_item_id); return title ? [{ materialId: row.material_item_id, title, lastOpenedAt: row.last_opened_at, lastOpenedLabel: formatMaterialViewDate(row.last_opened_at) }] : []; }).sort((a, b) => Date.parse(b.lastOpenedAt) - Date.parse(a.lastOpenedAt) || collator.compare(a.title, b.title) || compareIds(a.materialId, b.materialId));
  }
  return <Tab><StudentMaterialsAdminPanel studentId={studentId} folders={folders} materials={materials} viewed={viewed} loadError={loadError} viewedLoadError={viewedLoadError}/></Tab>;
}

async function TestsTab({ studentId }: { studentId: string }) {
  const admin = createAdminClient();
  const [assignmentResult, attemptsResult] = await Promise.all([
    admin.from("test_assignments").select("id, title, source_test_id, deadline_at, created_at").eq("student_id", studentId).order("created_at", { ascending: false }),
    admin.from("test_attempts").select("id,assignment_id,started_at,submitted_at,score,max_score").eq("student_id", studentId).order("started_at", { ascending: false }),
  ]);
  let loadError: string | undefined;
  if (assignmentResult.error) {
    console.error("Не удалось загрузить назначения ученика:", { code: assignmentResult.error.code, message: assignmentResult.error.message });
    loadError = "Не удалось загрузить назначенные тесты.";
  }
  const rows = (assignmentResult.data ?? []) as AssignmentRow[];
  const attempts = (attemptsResult.data ?? []) as AssignmentAttemptRow[];
  const submittedIds = attempts.filter((item) => item.submitted_at).map((item) => item.id);
  const summariesResult = submittedIds.length ? await admin.from("test_attempt_answers").select("attempt_id,is_correct").in("attempt_id", submittedIds) : { data: [], error: null };
  const summaryError = attemptsResult.error ?? summariesResult.error;
  if (summaryError) {
    console.error("Не удалось загрузить статусы назначенных тестов:", { code: summaryError.code, message: summaryError.message });
    loadError = "Не удалось загрузить статусы назначенных тестов.";
  }
  const review = new Set(((summariesResult.data ?? []) as AttemptAnswerSummaryRow[]).filter((item) => item.is_correct === null).map((item) => item.attempt_id));
  const grouped = new Map<string, AssignmentAttemptRow[]>();
  for (const attempt of attempts) grouped.set(attempt.assignment_id, [...(grouped.get(attempt.assignment_id) ?? []), attempt]);
  // Server-render timestamp is intentionally fixed for this request.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const assignments: AssignmentListItem[] = rows.map((item) => {
    const current = grouped.get(item.id) ?? [];
    const submitted = current.filter((attempt) => attempt.submitted_at).sort((a, b) => Date.parse(b.submitted_at!) - Date.parse(a.submitted_at!))[0] ?? null;
    const active = current.some((attempt) => !attempt.submitted_at);
    const status: AssignmentListItem["status"] = submitted ? review.has(submitted.id) ? "REVIEW" : "COMPLETED" : item.deadline_at && Date.parse(item.deadline_at) < now ? "OVERDUE" : active ? "IN_PROGRESS" : "EXPECTED";
    return { id: item.id, title: item.title, sourceTestId: item.source_test_id, deadlineAt: item.deadline_at, createdAt: item.created_at, status, latestSubmittedAttemptId: submitted?.id ?? null, submittedAt: submitted?.submitted_at ?? null, score: submitted?.score == null ? null : Number(submitted.score), maxScore: submitted?.max_score == null ? null : Number(submitted.max_score), hasAttempts: current.length > 0 };
  });
  return <Tab><TestAssignmentList studentId={studentId} assignments={assignments} loadError={loadError}/></Tab>;
}

async function TrainersTab({ studentId, adminId }: { studentId: string; adminId: string }) {
  const data = await loadAdminStudentTrainerReadModel(studentId, adminId);
  return <Tab><StudentTrainersPanel studentId={studentId} cards={data.trainers.cards} available={data.trainers.available} groups={data.trainers.groups} loadError={data.trainers.error ? "Не удалось загрузить тренажёры ученика." : undefined}/><FormulaRecallAssignmentsPanel studentId={studentId} topics={data.formulaRecall.topics} summary={data.formulaRecall.summary} loadError={data.formulaRecall.error ? "Не удалось загрузить назначения Formula Recall." : undefined}/><StudentMistakesCard studentId={studentId} count={data.mistakes.active} corrected={data.mistakes.corrected} error={data.mistakes.error}/></Tab>;
}

async function ResultsTab({ studentId }: { studentId: string }) {
  const data = await loadStudentProgressByStudentId(studentId, { lightweightAssignments: true });
  return <Tab>{data && <StudentProgressPage mode="admin" studentId={studentId} data={data}/>}</Tab>;
}

function Tab({ children }: { children: React.ReactNode }) { return <div className={styles.tabContent}>{children}</div>; }
function compareIds(a: string, b: string) { return a < b ? -1 : a > b ? 1 : 0; }
