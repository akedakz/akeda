"use server";
import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function removeMistake(studentId:string,mistakeId:string){const current=await getCurrentProfile();if(!current||current.profile?.role!=="ADMIN"||!uuid.test(studentId)||!uuid.test(mistakeId))return{ok:false};const result=await createAdminClient().rpc("remove_student_mistake_atomic",{p_mistake_id:mistakeId,p_student_id:studentId,p_admin_id:current.profile.id});if(result.error){console.error("MISTAKE_ADMIN_REMOVE",{code:result.error.code,message:result.error.message});return{ok:false}}const data=result.data as{status:string};if(data.status!=="removed"&&data.status!=="not_active")return{ok:false};revalidatePath(`/admin/students/${studentId}/mistakes`);revalidatePath(`/admin/students/${studentId}`);return{ok:true}}
