import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PageContent, PageContentLoading, PageHeader, PageShell } from "@/components/page-layout/page-layout";
import StudentProfilePage from "@/components/student/student-profile-page";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatResultDateLabel } from "@/lib/results/result-date-label";
import { createStudentAvatarUrl } from "@/lib/avatars/student-avatar";

export default function ProfilePage(){return <PageShell><PageHeader title="Профиль"/><PageContent><Suspense fallback={<PageContentLoading label="Загружаем профиль"/>}><ProfileContent/></Suspense></PageContent></PageShell>}
async function ProfileContent(){
  const current=await getCurrentProfile();
  if(!current)redirect("/login");if(current.profile?.role==="ADMIN")redirect("/admin");if(current.profile?.role!=="STUDENT")redirect("/dashboard");if(current.profile.student_status!=="ACTIVE")return null;
  const admin=createAdminClient();
  const[profileResult,linksResult]=await Promise.all([admin.from("profiles").select("full_name,email,student_status,created_at,avatar_path").eq("id",current.user.id).eq("role","STUDENT").single(),admin.from("student_learning_programs").select("program_id").eq("student_id",current.user.id)]);
  if(profileResult.error||linksResult.error){console.error("STUDENT_PROFILE_LOAD",{profile:profileResult.error?.message,programs:linksResult.error?.message});throw new Error("Не удалось загрузить профиль.")}
  const ids=linksResult.data.map(item=>item.program_id),programs=ids.length?await admin.from("learning_programs").select("id,name,is_active").in("id",ids):{data:[],error:null};
  if(programs.error){console.error("STUDENT_PROFILE_PROGRAMS",{code:programs.error.code,message:programs.error.message});throw new Error("Не удалось загрузить программы.")}
  return <StudentProfilePage avatarUrl={await createStudentAvatarUrl(profileResult.data.avatar_path)} profile={{fullName:profileResult.data.full_name??"Ученик",email:current.user.email??profileResult.data.email??"—",status:profileResult.data.student_status,createdLabel:formatResultDateLabel(profileResult.data.created_at),programs:(programs.data??[]).map(item=>item.name)}}/>;
}
