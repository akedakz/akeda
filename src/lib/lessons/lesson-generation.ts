import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

const zone = "Asia/Almaty";
type SlotRow = { id: string; weekday: number; start_time: string; duration_minutes: number; valid_from: string; valid_until: string | null };
const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
function parts(date: Date) { const values = Object.fromEntries(formatter.formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)])); return values as Record<"year"|"month"|"day"|"hour"|"minute"|"second", number>; }
function localDate(date: Date) { const value = parts(date); return `${value.year}-${String(value.month).padStart(2,"0")}-${String(value.day).padStart(2,"0")}`; }
export function almatyLocalToUtc(date: string, time: string) { const [year,month,day] = date.split("-").map(Number); const [hour,minute,second=0] = time.split(":").map(Number); const target = Date.UTC(year,month-1,day,hour,minute,second); let guess = target; for (let index=0;index<2;index+=1) { const seen=parts(new Date(guess)); const represented=Date.UTC(seen.year,seen.month-1,seen.day,seen.hour,seen.minute,seen.second); guess += target-represented; } return new Date(guess); }
function datesBetween(start: string, end: string) { const result:string[]=[]; let cursor=new Date(`${start}T00:00:00Z`); const last=new Date(`${end}T00:00:00Z`); while(cursor<=last){result.push(cursor.toISOString().slice(0,10));cursor=new Date(cursor.getTime()+86400000);} return result; }
function weekday(date:string){const value=new Date(`${date}T00:00:00Z`).getUTCDay();return value===0?7:value;}

export function almatyDate(date = new Date()) { return localDate(date); }
export function addCalendarDays(date: string, amount: number) { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate()+amount); return value.toISOString().slice(0,10); }

export async function ensureStudentLessons(admin: ReturnType<typeof createAdminClient>, studentId: string, rangeStart: Date, rangeEnd: Date) {
  const startDate=localDate(rangeStart),endDate=localDate(rangeEnd);
  const {data,error}=await admin.from("student_schedule_slots").select("id, weekday, start_time, duration_minutes, valid_from, valid_until").eq("student_id",studentId).lte("valid_from",endDate).or(`valid_until.is.null,valid_until.gte.${startDate}`);
  if(error)return{error}; const slots=(data??[]) as SlotRow[]; const lessons: {student_id:string;schedule_slot_id:string;starts_at:string;ends_at:string}[]=[];
  for(const date of datesBetween(startDate,endDate)) for(const slot of slots) if(slot.weekday===weekday(date)&&slot.valid_from<=date&&(!slot.valid_until||slot.valid_until>=date)){const start=almatyLocalToUtc(date,slot.start_time);const duration=Number(slot.duration_minutes);if(duration<15||duration>300||Number.isNaN(start.getTime())||start<=rangeStart||start>rangeEnd)continue;lessons.push({student_id:studentId,schedule_slot_id:slot.id,starts_at:start.toISOString(),ends_at:new Date(start.getTime()+duration*60000).toISOString()});}
  if(!lessons.length)return{error:null}; return admin.from("student_lessons").upsert(lessons,{onConflict:"student_id,starts_at",ignoreDuplicates:true}).then((result)=>({error:result.error}));
}
