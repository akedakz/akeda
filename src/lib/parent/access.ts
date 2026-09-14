import "server-only";

import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";

export type ParentChild = { id: string; fullName: string; email: string | null };

export async function getParentContext() {
  const current = await getCurrentProfile();
  if (!current || current.profile?.role !== "PARENT") return null;
  return { current, admin: createAdminClient() };
}

export async function loadParentChildren(): Promise<ParentChild[] | null> {
  const context = await getParentContext();
  if (!context) return null;
  const result = await context.admin.from("profiles").select("id,full_name,email").eq("role", "STUDENT").eq("parent_id", context.current.profile!.id).order("full_name").order("id");
  if (result.error) throw result.error;
  return (result.data ?? []).map((child) => ({ id: child.id, fullName: child.full_name?.trim() || "Ученик", email: child.email }));
}

export async function requireParentChild(studentId: string) {
  const context = await getParentContext();
  if (!context) return null;
  const result = await context.admin.from("profiles").select("id,full_name,email").eq("id", studentId).eq("role", "STUDENT").eq("parent_id", context.current.profile!.id).maybeSingle();
  if (result.error || !result.data) return null;
  return { context, child: { id: result.data.id, fullName: result.data.full_name?.trim() || "Ученик", email: result.data.email } as ParentChild };
}
