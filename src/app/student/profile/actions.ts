"use server";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const categories=["PAGE","MATERIAL","TEST","DATA","OTHER"] as const;
export type SupportActionState={ok:boolean;message:string};
export async function sendSupportMessage(_:SupportActionState,data:FormData):Promise<SupportActionState>{const current=await getCurrentProfile();if(!current||current.profile?.role!=="STUDENT"||current.profile.student_status!=="ACTIVE")return{ok:false,message:"Недостаточно прав."};const category=String(data.get("category")??"");const message=String(data.get("message")??"").trim();if(!categories.includes(category as typeof categories[number])||message.length<10||message.length>2000)return{ok:false,message:"Проверьте категорию и сообщение от 10 до 2000 символов."};const result=await createAdminClient().rpc("create_support_message_rate_limited",{p_student_id:current.user.id,p_category:category,p_message:message});if(result.error){console.error("SUPPORT_INSERT",{code:result.error.code,message:result.error.message});return{ok:false,message:"Не удалось отправить сообщение. Попробуйте ещё раз."}}const status=(result.data as {status?:string}|null)?.status;if(status==="rate_limited")return{ok:false,message:"Подождите 30 секунд перед следующим сообщением."};if(status!=="created")return{ok:false,message:"Не удалось отправить сообщение. Попробуйте ещё раз."};return{ok:true,message:"Сообщение отправлено."}}
export async function signOutToHome(){const supabase=await createClient({requireCookieWrites:true});await supabase.auth.signOut({scope:"local"});redirect("/")}
