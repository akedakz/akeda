import type { Metadata } from "next";
import { notFound,redirect } from "next/navigation";
import BackLink from "@/components/back-link";
import TestAttemptReview from "@/components/tests/test-attempt-review";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { loadAdminStudentMistakes } from "@/lib/mistakes/runtime";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TestSnapshot } from "@/lib/tests/test-snapshot-types";
import RemoveButton from "./remove-button";
import styles from "./mistakes.module.css";

export const metadata:Metadata={title:"Работа над ошибками ученика — NSP"};
export default async function Page({params}:{params:Promise<{id:string}>}){const current=await getCurrentProfile();if(!current)redirect("/login");if(current.profile?.role!=="ADMIN")redirect("/dashboard");const{id}=await params;const profile=await createAdminClient().from("profiles").select("id,full_name").eq("id",id).eq("role","STUDENT").maybeSingle();if(profile.error||!profile.data)notFound();const mistakes=await loadAdminStudentMistakes(id,current.profile.id);return <main className={styles.page}><BackLink href={`/admin/students/${id}?tab=trainers`}>К тренажёрам ученика</BackLink><header><span>Системный тренажёр</span><h1>Работа над ошибками</h1><p>{profile.data.full_name??"Ученик"} · {mistakes.length} активных задач</p></header>{mistakes.length?<div className={styles.list}>{mistakes.map((item,index)=>{const snapshot:TestSnapshot={version:2,sourceTestId:"mistake",createdBy:current.profile!.id,title:item.sourceTitle,description:"",questions:[item.question]};return <article className={styles.card} key={item.id}><div className={styles.meta}><span>№ {index+1}</span><span>Источник: {item.sourceTitle}</span><span>Первая ошибка: {format(item.firstFailedAt)}</span><span>Последняя: {format(item.lastFailedAt)}</span><span>Повторных появлений: {item.reactivationCount}</span></div><TestAttemptReview snapshot={snapshot} answers={new Map(item.latestFailedAnswer?[[item.question.key,item.latestFailedAnswer]]:[])} imageUrls={item.question.imagePath&&item.imageUrl?{[item.question.imagePath]:item.imageUrl}:{}} showCorrect admin/><div className={styles.remove}><RemoveButton studentId={id} mistakeId={item.id}/></div></article>})}</div>:<section className={styles.empty}><h2>У ученика нет активных ошибок</h2></section>}</main>}
function format(value:string){return new Intl.DateTimeFormat("ru-RU",{dateStyle:"medium",timeStyle:"short"}).format(new Date(value))}
