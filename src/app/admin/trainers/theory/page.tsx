import type { Metadata } from "next";
import BackLink from "@/components/back-link";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TheoryDefinition, TheoryStatus } from "@/lib/trainers/theory-types";
import TheoryLibrary from "./theory-library";
import studentStyles from "@/app/student/trainers/trainers.module.css";
import type { TrainerGroup } from "@/lib/trainers/trainer-groups";

export const metadata: Metadata = { title: "Theory — NSP" };
type Row = { id: string; title: string; status: TheoryStatus; definition: TheoryDefinition; content_revision: number; updated_at: string;group_id:string|null };

export default async function AdminTheoryPage() {
  const current = await getCurrentProfile();
  const adminId = current?.profile?.role === "ADMIN" ? current.profile.id : "";
  const db=createAdminClient(); const [result,groupsResult] = adminId ? await Promise.all([db.from("trainers").select("id,title,status,definition,content_revision,updated_at,group_id").eq("owner_admin_id", adminId).eq("type", "THEORY").order("updated_at", { ascending: false }),db.from("trainer_groups").select("id,trainer_type,title,sort_order").eq("owner_admin_id",adminId).eq("trainer_type","THEORY").order("sort_order")]) : [{data:[],error:null},{data:[],error:null}];
  const trainers = ((result.data ?? []) as Row[]).map((row) => ({ id: row.id, title: row.title, status: row.status, questionCount: Array.isArray(row.definition?.questions) ? row.definition.questions.length : 0, updatedAt: row.updated_at,groupId:row.group_id }));
  const groups=((groupsResult.data??[]) as {id:string;trainer_type:"THEORY";title:string;sort_order:number}[]).map((g):TrainerGroup=>({id:g.id,trainerType:g.trainer_type,title:g.title,sortOrder:g.sort_order}));
  return <div className={studentStyles.page}><BackLink href="/admin/trainers">Тренажёры</BackLink><TheoryLibrary trainers={trainers} groups={groups} loadError={Boolean(result.error||groupsResult.error)}/></div>;
}
