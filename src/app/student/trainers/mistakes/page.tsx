import type { Metadata } from "next";
import { redirect } from "next/navigation";
import BackLink from "@/components/back-link";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { loadStudentMistakeSession } from "@/lib/mistakes/runtime";
import MistakeRunner from "./mistake-runner";
import styles from "./mistakes.module.css";

export const metadata:Metadata={title:"Работа над ошибками — NSP"};
export default async function Page(){const current=await getCurrentProfile();if(!current)redirect("/login");if(current.profile?.role!=="STUDENT"||current.profile.student_status!=="ACTIVE")redirect("/dashboard");const session=await loadStudentMistakeSession(current.profile.id);return <main className={styles.page}><BackLink href="/student/trainers">Тренажёры</BackLink><header><span>Системный тренажёр</span><h1>Работа над ошибками</h1></header>{session.mistake?<MistakeRunner key={`${session.mistake.id}:${session.mistake.activationVersion}`} initial={session}/>:<section className={styles.empty}><h2>Все ошибки разобраны</h2><p>Новых задач пока нет.</p></section>}</main>}
