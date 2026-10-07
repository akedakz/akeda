import { randomInt } from "node:crypto";

export type SkillDifficulty = "BASIC" | "CORE" | "CHALLENGE";
export type GeneratedSection1Task = {
  prompt: string;
  expectedAnswer: string;
  difficulty: SkillDifficulty;
  parameters: Record<string, string | number | boolean>;
};

export type Rat = { n: bigint; d: bigint };
export type Template = { id: string; difficulty: SkillDifficulty; make: () => GeneratedSection1Task };

export type Config = { questions_per_attempt?: number; version?: number };

export const ri = (min: number, max: number) => randomInt(min, max + 1);
export const pick = <T>(items: readonly T[]) => items[ri(0, items.length - 1)];
export const chance = (p = 0.5) => randomInt(0, 1_000_000) < p * 1_000_000;
export function shuffle<T>(items: T[]) { for (let i = items.length - 1; i > 0; i--) { const j = ri(0, i); [items[i], items[j]] = [items[j], items[i]]; } return items; }
export function gcdBig(a: bigint, b: bigint) { let x = a < BigInt(0) ? -a : a, y = b < BigInt(0) ? -b : b; while (y) [x, y] = [y, x % y]; return x || BigInt(1); }
export function R(n: number | bigint, d: number | bigint = 1): Rat { let nn = BigInt(n), dd = BigInt(d); if (dd === BigInt(0)) throw new Error("zero denominator"); if (dd < BigInt(0)) { nn = -nn; dd = -dd; } const g = gcdBig(nn, dd); return { n: nn / g, d: dd / g }; }
export const add = (a: Rat, b: Rat) => R(a.n*b.d+b.n*a.d, a.d*b.d);
export const sub = (a: Rat, b: Rat) => R(a.n*b.d-b.n*a.d, a.d*b.d);
export const mul = (a: Rat, b: Rat) => R(a.n*b.n, a.d*b.d);
export const div = (a: Rat, b: Rat) => { if (b.n===BigInt(0)) throw new Error("division by zero"); return R(a.n*b.d, a.d*b.n); };
export const neg = (a: Rat) => R(-a.n,a.d);
export const abs = (a: Rat) => R(a.n<BigInt(0)?-a.n:a.n,a.d);
export function powRat(a: Rat, e: number): Rat { let out=R(1); for(let i=0;i<e;i++) out=mul(out,a); return out; }
export function canonical(a: Rat) { return a.d===BigInt(1) ? String(a.n) : `${a.n}/${a.d}`; }
export function finiteScale(a: Rat) { let d=a.d, twos=0, fives=0; while(d%BigInt(2)===BigInt(0)){d/=BigInt(2);twos++;} while(d%BigInt(5)===BigInt(0)){d/=BigInt(5);fives++;} return d===BigInt(1) ? Math.max(twos,fives) : null; }
export function decimalDot(a: Rat, minScale=0): string {
  const scale = finiteScale(a); if (scale===null) throw new Error(`non terminating ${canonical(a)}`);
  const s=Math.max(scale,minScale); let factor=BigInt(10)**BigInt(s); let scaled=a.n*factor/a.d; const sign=scaled<BigInt(0)?"-":""; if(scaled<BigInt(0)) scaled=-scaled;
  let digits=String(scaled).padStart(s+1,"0"); if(s===0) return sign+digits;
  return sign+digits.slice(0,-s)+"."+digits.slice(-s);
}
const comma = (s: string) => s.replace(".",",");
export function displayFraction(a: Rat){ return canonical(a); }
export function displayDecimal(a: Rat,minScale=0){ return comma(decimalDot(a,minScale)); }
export function task(id:string,difficulty:SkillDifficulty,prompt:string,answer:Rat,display?:string,extra:Record<string,string|number|boolean>={}):GeneratedSection1Task{
  return {prompt,expectedAnswer:canonical(answer),difficulty,parameters:{template:id,answer_display:display??(answer.d===BigInt(1)?String(answer.n):displayFraction(answer)),...extra}};
}
export function intTask(id:string,difficulty:SkillDifficulty,prompt:string,answer:number,extra:Record<string,string|number|boolean>={}){ return task(id,difficulty,prompt,R(answer),String(answer),extra); }
export function dec(value:number,scale:number){ return R(value,10**scale); }
export function fmtScaled(value:number,scale:number,minScale=scale){ return displayDecimal(dec(value,scale),minScale); }
export function coprime(a:number,b:number){ let x=Math.abs(a),y=Math.abs(b); while(y){[x,y]=[y,x%y];} return x===1; }
export function lcm(a:number,b:number){ let x=a,y=b; while(y){[x,y]=[y,x%y];} return Math.abs(a*b)/x; }
export function makeFraction(maxDen=12, proper=true){ const d=ri(2,maxDen); const n=proper?ri(1,d-1):ri(1,maxDen); return R(n,d); }
export function makeNonIntegerFraction(maxDen=12, proper=false){ for(let i=0;i<100;i++){ const r=makeFraction(maxDen,proper); if(r.d>BigInt(1))return r; } throw new Error("fraction generation failed"); }
export function nonIntegerDecimal(scale=1,maxWhole=20){ for(let i=0;i<100;i++){ const r=R(ri(1,maxWhole*10**scale-1),10**scale); if(r.d>BigInt(1))return r; } throw new Error("decimal generation failed"); }
export function signed(n:number){ return chance()?n:-n; }
export function nonZeroInt(min:number,max:number){ let x=0; while(x===0)x=ri(min,max); return x; }
export function uniqueIntegers(count:number,min:number,max:number){ const s=new Set<number>(); while(s.size<count)s.add(ri(min,max)); return [...s]; }
