import type { Metadata } from "next";
import BackLink from "@/components/back-link";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import QuickProblemsLibrary from "./quick-problems-library";
import type { TrainerDefinition } from "@/lib/trainers/trainer-import";
import styles from "../trainers.module.css";
import studentStyles from "@/app/student/trainers/trainers.module.css";
import type { TrainerGroup } from "@/lib/trainers/trainer-groups";

export const metadata: Metadata = { title: "Быстрые задачи — AKEDA" };
type Row = { id: string; title: string; description: string; definition: unknown; content_revision: number; updated_at: string; group_id: string | null };

export default async function QuickProblemsPage() {
  const current = await getCurrentProfile();
  const adminId = current?.profile?.role === "ADMIN" ? current.profile.id : "";
  const db=createAdminClient();
  const [result,groupsResult] = adminId ? await Promise.all([db.from("trainers").select("id,title,description,definition,content_revision,updated_at,group_id").eq("owner_admin_id", adminId).eq("type", "QUICK_PROBLEMS").order("updated_at", { ascending: false }),db.from("trainer_groups").select("id,trainer_type,title,sort_order").eq("owner_admin_id",adminId).eq("trainer_type","QUICK_PROBLEMS").order("sort_order")]) : [{ data: [], error: null },{data:[],error:null}];
  const trainers = ((result.data ?? []) as Row[]).map((row) => {
    const definition = row.definition as { skills?: Array<{ variants?: unknown[] }> };
    const skills = Array.isArray(definition?.skills) ? definition.skills : [];
    return { id: row.id, title: row.title, description: row.description, definition: row.definition as TrainerDefinition, contentRevision: row.content_revision, updatedAt: row.updated_at, groupId:row.group_id, skillCount: skills.length, variantCount: skills.reduce((sum, skill) => sum + (Array.isArray(skill.variants) ? skill.variants.length : 0), 0) };
  });
  const groups=((groupsResult.data??[]) as {id:string;trainer_type:"QUICK_PROBLEMS";title:string;sort_order:number}[]).map((g):TrainerGroup=>({id:g.id,trainerType:g.trainer_type,title:g.title,sortOrder:g.sort_order}));
  return <div className={studentStyles.page}><BackLink href="/admin/trainers">Тренажёры</BackLink>{result.error||groupsResult.error ? <p className={styles.error}>Не удалось загрузить библиотеку тренажёров.</p> : <QuickProblemsLibrary trainers={trainers} groups={groups} />}</div>;
}
