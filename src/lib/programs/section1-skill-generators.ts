import { type Template, type Config, shuffle, pick, canonical, R } from "./section1-generator-core";
import { templates11, templates12, templates13, templates14, templates15, templates16, templates17 } from "./section1-generators-a";
import { templates18, templates19, templates110, templates111, templates112, templates113, templates114 } from "./section1-generators-b";
export type { GeneratedSection1Task, SkillDifficulty } from "./section1-generator-core";
import type { GeneratedSection1Task } from "./section1-generator-core";

const MAP:Record<string,()=>Template[]>={
  nis_s1_1_v1:templates11, nis_s1_2_v1:templates12, nis_s1_3_v1:templates13, nis_s1_4_v1:templates14,
  nis_s1_5_v1:templates15, nis_s1_6_v1:templates16, nis_s1_7_v1:templates17, nis_s1_8_v1:templates18,
  nis_s1_9_v1:templates19, nis_s1_10_v1:templates110, nis_s1_11_v1:templates111, nis_s1_12_v1:templates112,
  nis_s1_13_v1:templates113, nis_s1_14_v1:templates114,
};
export const SECTION1_TEMPLATE_COUNTS=Object.fromEntries(Object.entries(MAP).map(([k,f])=>[k,f().length]));
export function isSection1Generator(key:string){ return key in MAP; }
export function generateSection1Tasks(generatorKey:string,configValue:unknown):GeneratedSection1Task[]{
  const factory=MAP[generatorKey]; if(!factory)throw new Error("Unknown Section 1 generator");
  const config=(configValue&&typeof configValue==="object"?configValue:{}) as Config; const count=Number.isInteger(config.questions_per_attempt)?Number(config.questions_per_attempt):10;
  if(count<1||count>20)throw new Error("Invalid question count");
  const templates=factory(); const chosen=shuffle([...templates]); while(chosen.length<count)chosen.push(pick(templates));
  const tasks:GeneratedSection1Task[]=[]; const prompts=new Set<string>();
  for(const template of chosen.slice(0,count)){
    let produced:GeneratedSection1Task|null=null;
    for(let tries=0;tries<150;tries++){const candidate=template.make(); if(!prompts.has(candidate.prompt)){produced=candidate;break;}}
    if(!produced)throw new Error(`Could not generate unique task for ${template.id}`);
    prompts.add(produced.prompt); tasks.push(produced);
  }
  return shuffle(tasks);
}

export function normalizeNumericAnswer(raw:string):string|null{
  let s=raw.trim().replaceAll("−","-").replaceAll(",",".").replace(/\s*\/\s*/g,"/").replace(/\s+/g," ");
  if(!s)return null;
  let m=s.match(/^([+-]?)(\d+) (\d+)\/(\d+)$/);
  if(m){const sign=m[1]==="-"?-BigInt(1):BigInt(1),whole=BigInt(m[2]),num=BigInt(m[3]),den=BigInt(m[4]);if(den===BigInt(0))return null;return canonical(R(sign*(whole*den+num),den));}
  m=s.match(/^([+-]?\d+)\/(\d+)$/); if(m){const den=BigInt(m[2]);if(den===BigInt(0))return null;return canonical(R(BigInt(m[1]),den));}
  m=s.match(/^([+-]?)(\d+)(?:\.(\d+))?$/); if(m){const sign=m[1]==="-"?-BigInt(1):BigInt(1),whole=m[2],frac=m[3]??"";const n=BigInt(whole+frac)*sign,d=BigInt(10)**BigInt(frac.length);return canonical(R(n,d));}
  return null;
}
