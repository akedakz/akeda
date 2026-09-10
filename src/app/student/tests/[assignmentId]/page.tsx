import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import type { TestSnapshot } from "@/lib/tests/test-snapshot-types";
import { createAdminClient } from "@/lib/supabase/admin";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isSnapshot(value: unknown): value is TestSnapshot { const item = value as Partial<TestSnapshot> | null; return Boolean((item?.version === 1 || item?.version === 2) && Array.isArray(item.questions)); }

export default async function StudentAssignmentEntry({ params }: { params: Promise<{ assignmentId: string }> }) {
  const current = await getCurrentProfile();
  if (!current) redirect("/login");
  if (current.profile?.role !== "STUDENT" || current.profile.student_status !== "ACTIVE") redirect("/student/tests");
  const { assignmentId } = await params;
  if (!uuid.test(assignmentId)) redirect("/student/tests");

  const admin = createAdminClient();
  const [assignment, attempts] = await Promise.all([
    admin.from("test_assignments").select("id,snapshot").eq("id", assignmentId).eq("student_id", current.user.id).maybeSingle(),
    admin.from("test_attempts").select("id,submitted_at,started_at").eq("assignment_id", assignmentId).eq("student_id", current.user.id).order("started_at", { ascending: false }),
  ]);
  if (assignment.error || attempts.error || !assignment.data || !isSnapshot(assignment.data.snapshot)) redirect("/student/tests");

  const active = attempts.data.find((attempt) => !attempt.submitted_at);
  if (active) redirect(`/student/tests/${assignmentId}/attempts/${active.id}`);
  const completed = attempts.data.find((attempt) => attempt.submitted_at);
  if (completed) redirect(`/student/tests/${assignmentId}/attempts/${completed.id}`);

  const started = await admin.rpc("start_student_test_attempt_atomic", { p_assignment_id: assignmentId, p_student_id: current.user.id });
  const result = started.data as { status?: string; attempt_id?: string } | null;
  if (started.error || !result?.attempt_id || (result.status !== "created" && result.status !== "active")) redirect("/student/tests");
  redirect(`/student/tests/${assignmentId}/attempts/${result.attempt_id}`);
}
