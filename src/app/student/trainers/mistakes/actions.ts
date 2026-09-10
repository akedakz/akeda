"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import type { StudentAnswer } from "@/lib/tests/student-test-types";

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type MistakeSubmitResult={status:"correct"|"wrong"|"stale"|"not_oldest"|"error";activeCount?:number};

export async function submitMistakeAnswer(mistakeId:string,activationVersion:number,answer:StudentAnswer,requestId:string):Promise<MistakeSubmitResult>{
  const current=await getCurrentProfile();
  if(!current||current.profile?.role!=="STUDENT"||current.profile.student_status!=="ACTIVE")return{status:"error"};
  if(!uuid.test(mistakeId)||!uuid.test(requestId)||!Number.isSafeInteger(activationVersion)||activationVersion<1||!answer||typeof answer!=="object")return{status:"error"};
  const result=await createAdminClient().rpc("submit_student_mistake_answer_atomic",{p_mistake_id:mistakeId,p_activation_version:activationVersion,p_submitted_answer:answer,p_request_id:requestId,p_student_id:current.profile.id});
  if(result.error){console.error("MISTAKE_SUBMIT",{code:result.error.code,message:result.error.message});return{status:"error"};}
  const data=result.data as {status:string;activeCount?:number};
  if(data.status==="correct"){revalidatePath("/student/trainers");revalidatePath("/student/trainers/mistakes");}
  return ["correct","wrong","stale","not_oldest"].includes(data.status)?{status:data.status as MistakeSubmitResult["status"],activeCount:data.activeCount}:{status:"error"};
}
