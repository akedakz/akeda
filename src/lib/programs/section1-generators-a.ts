import {
  type Template, type Rat, R, add, sub, mul, div, canonical, finiteScale, displayFraction, displayDecimal,
  task, intTask, dec, pick, chance, ri, shuffle, lcm, makeFraction, makeNonIntegerFraction,
  nonIntegerDecimal, signed, uniqueIntegers
} from "./section1-generator-core";

export function templates11():Template[]{ return [
  {id:"1.1-A",difficulty:"BASIC",make:()=>{ const op=chance()?"+":"−"; let a=ri(20,999),b=ri(20,999); if(op==="−"&&a<b)[a,b]=[b,a]; const ans=op==="+"?a+b:a-b; return intTask("1.1-A","BASIC",`${a} ${op} ${b} = ?`,ans); }},
  {id:"1.1-B",difficulty:"CORE",make:()=>{ if(chance()){const a=ri(2,50),b=ri(2,50);return intTask("1.1-B","CORE",`${a} × ${b} = ?`,a*b);} const q=ri(2,100),d=ri(2,30);return intTask("1.1-B","CORE",`${q*d} ÷ ${d} = ?`,q);}},
  {id:"1.1-C",difficulty:"CORE",make:()=>{let a=signed(ri(2,50)),b=signed(ri(2,50)); if(a>0&&b>0)a=-a; const op=chance()?"+":"−";return intTask("1.1-C","CORE",`${a} ${op} (${b}) = ?`,op==="+"?a+b:a-b);}},
  {id:"1.1-D",difficulty:"CORE",make:()=>{const q=signed(ri(2,20)),d=signed(ri(2,12)); if(chance())return intTask("1.1-D","CORE",`${q} × (${d}) = ?`,q*d);return intTask("1.1-D","CORE",`${q*d} ÷ (${d}) = ?`,q);}},
  {id:"1.1-E",difficulty:"CORE",make:()=>{let a=makeFraction(12),b=makeFraction(12); while(lcm(Number(a.d),Number(b.d))>60)b=makeFraction(12); const plus=chance(); const ans=plus?add(a,b):sub(a,b);return task("1.1-E","CORE",`${displayFraction(a)} ${plus?"+":"−"} ${displayFraction(b)} = ?`,ans);}},
  {id:"1.1-F",difficulty:"CHALLENGE",make:()=>{let a=makeNonIntegerFraction(12,false),b=makeNonIntegerFraction(12,false); const multiply=chance(); const ans=multiply?mul(a,b):div(a,b);return task("1.1-F","CHALLENGE",`${displayFraction(a)} ${multiply?"×":"÷"} ${displayFraction(b)} = ?`,ans);}},
  {id:"1.1-G",difficulty:"CHALLENGE",make:()=>{const a=ri(1,12),b=makeNonIntegerFraction(10,false); const plus=chance(); const ans=plus?add(R(a),b):sub(R(a),b);return task("1.1-G","CHALLENGE",`${a} ${plus?"+":"−"} ${displayFraction(b)} = ?`,ans);}},
];}
export function templates12():Template[]{return [
  {id:"1.2-A",difficulty:"BASIC",make:()=>{const a=-ri(2,50);let b=ri(2,50);while(b===-a)b=ri(2,50); return intTask("1.2-A","BASIC",`${a} + ${b} = ?`,a+b);}},
  {id:"1.2-B",difficulty:"CORE",make:()=>{let a=ri(-40,40),b=ri(-40,40);if(a>=0&&b>=0)b=-Math.max(2,b||2);return intTask("1.2-B","CORE",`${a} − (${b}) = ?`,a-b);}},
  {id:"1.2-C",difficulty:"CORE",make:()=>{const a=-ri(2,12),b=chance()?-ri(2,12):ri(2,12);return intTask("1.2-C","CORE",`${a} × (${b}) = ?`,a*b);}},
  {id:"1.2-D",difficulty:"CORE",make:()=>{const q=signed(ri(2,20)),d=signed(ri(2,12));return intTask("1.2-D","CORE",`${q*d} ÷ (${d}) = ?`,q);}},
  {id:"1.2-E",difficulty:"CHALLENGE",make:()=>{const a=-ri(2,30),b=ri(2,30),c=-ri(2,30);const ans=a+b-c;return intTask("1.2-E","CHALLENGE",`${a} + ${b} − (${c}) = ?`,ans);}},
];}
export function templates13():Template[]{return [
  {id:"1.3-A",difficulty:"BASIC",make:()=>{const x=chance(.7)?-ri(1,100):ri(1,100);return intTask("1.3-A","BASIC",`|${x}| = ?`,Math.abs(x));}},
  {id:"1.3-B",difficulty:"BASIC",make:()=>{const x=signed(ri(1,100));return intTask("1.3-B","BASIC",`Число, противоположное ${x}: ?`,-x);}},
  {id:"1.3-C",difficulty:"CORE",make:()=>{const a=signed(ri(1,30)),b=signed(ri(1,30)),plus=chance();return intTask("1.3-C","CORE",`|${a}| ${plus?"+":"−"} |${b}| = ?`,plus?Math.abs(a)+Math.abs(b):Math.abs(a)-Math.abs(b));}},
  {id:"1.3-D",difficulty:"CHALLENGE",make:()=>{const x=-ri(2,100);return intTask("1.3-D","CHALLENGE",`Число, противоположное |${x}|: ?`,-Math.abs(x));}},
];}
export function templates14():Template[]{return [
  {id:"1.4-A",difficulty:"BASIC",make:()=>{const [a,b]=uniqueIntegers(2,-50,50);return intTask("1.4-A","BASIC",`Какое число больше: ${a} или ${b}?`,Math.max(a,b));}},
  {id:"1.4-B",difficulty:"CORE",make:()=>{const whole=ri(0,20),a=ri(1,9)*10,b=ri(1,99);const ra=dec(whole*100+a,2),rb=dec(whole*100+b,2);if(canonical(ra)===canonical(rb))return templates14()[1].make();const ans=ra.n*rb.d<rb.n*ra.d?ra:rb;return task("1.4-B","CORE",`Какое число меньше: ${displayDecimal(ra,1)} или ${displayDecimal(rb,2)}?`,ans,displayDecimal(ans));}},
  {id:"1.4-C",difficulty:"CORE",make:()=>{const v=uniqueIntegers(3,-20,20); const sorted=[...v].sort((a,b)=>a-b);return intTask("1.4-C","CORE",`Какое число стоит посередине по величине: ${v.join("; ")}?`,sorted[1]);}},
  {id:"1.4-D",difficulty:"CORE",make:()=>{let L=ri(-20,15),R=ri(L+3,20);const inside=ri(L+1,R-1);let out1=ri(-25,L-1),out2=ri(R+1,25);const opts=shuffle([inside,out1,out2]);return intTask("1.4-D","CORE",`Какое из чисел ${opts.join("; ")} удовлетворяет ${L} < x < ${R}?`,inside);}},
  {id:"1.4-E",difficulty:"CORE",make:()=>{let a=makeFraction(15),b=makeFraction(15);while(canonical(a)===canonical(b))b=makeFraction(15);const greater=a.n*b.d>b.n*a.d?a:b;return task("1.4-E","CORE",`Какая дробь больше: ${displayFraction(a)} или ${displayFraction(b)}?`,greater,displayFraction(greater));}},
  {id:"1.4-F",difficulty:"CHALLENGE",make:()=>{const x=ri(-15,15);const left=dec(x*10-ri(1,9),1),right=dec(x*10+ri(1,9),1);return intTask("1.4-F","CHALLENGE",`Найдите единственное целое x: ${displayDecimal(left,1)} < x < ${displayDecimal(right,1)}.`,x);}},
];}
export function templates15():Template[]{return [
  {id:"1.5-A",difficulty:"BASIC",make:()=>{let a=ri(10,100);const b=ri(2,12),c=ri(2,12),plus=chance();const prod=b*c;if(!plus&&a<prod)a=prod+ri(0,50);const ans=plus?a+prod:a-prod;return intTask("1.5-A","BASIC",`${a} ${plus?"+":"−"} ${b} × ${c} = ?`,ans);}},
  {id:"1.5-B",difficulty:"CORE",make:()=>{let a=ri(2,50),b=ri(2,50),c=ri(2,12),plus=chance();if(!plus&&a<b)[a,b]=[b,a];const x=plus?a+b:a-b;return intTask("1.5-B","CORE",`(${a} ${plus?"+":"−"} ${b}) × ${c} = ?`,x*c);}},
  {id:"1.5-C",difficulty:"CORE",make:()=>{const a=ri(2,15),b=ri(2,15),q=ri(2,12),c=ri(1,30);return intTask("1.5-C","CORE",`${(a+b)*q} ÷ (${a} + ${b}) + ${c} = ?`,q+c);}},
  {id:"1.5-D",difficulty:"CORE",make:()=>{const b=ri(2,12),q=ri(2,20),c=ri(2,9);const a=b*q;return intTask("1.5-D","CORE",`${a} ÷ ${b} × ${c} = ?`,q*c);}},
  {id:"1.5-E",difficulty:"CHALLENGE",make:()=>{const diff=ri(2,12),b=ri(2,12),a=b+diff,q=ri(2,15),c=ri(2,9),d=ri(1,30),plus=chance();const ans=q*c+(plus?d:-d);return intTask("1.5-E","CHALLENGE",`${diff*q} ÷ (${a} − ${b}) × ${c} ${plus?"+":"−"} ${d} = ?`,ans);}},
  {id:"1.5-F",difficulty:"CHALLENGE",make:()=>{const a=ri(2,9),b=ri(2,9),q=ri(2,10),c=ri(3,10),d=ri(1,c-1);const dividend=(a+b)*q;return intTask("1.5-F","CHALLENGE",`${dividend} ÷ (${a} + ${b}) × (${c} − ${d}) = ?`,q*(c-d));}},
];}
export function templates16():Template[]{return [
  {id:"1.6-A",difficulty:"BASIC",make:()=>{const round=pick([50,100,200,500]),a=ri(11,round-11),c=round-a,b=ri(11,99);const vals=shuffle([a,b,c]);return intTask("1.6-A","BASIC",`${vals.join(" + ")} = ?`,round+b);}},
  {id:"1.6-B",difficulty:"CORE",make:()=>{const [a,b]=pick([[25,4],[50,2],[125,8]] as const),n=ri(3,25),vals=shuffle([a,b,n]);return intTask("1.6-B","CORE",`${vals.join(" × ")} = ?`,a*b*n);}},
  {id:"1.6-C",difficulty:"CORE",make:()=>{const B=pick([10,100,1000]),delta=chance()?1:-1,n=ri(3,99);const a=B+delta;return intTask("1.6-C","CORE",`${a} × ${n} = ?`,a*n);}},
  {id:"1.6-D",difficulty:"CORE",make:()=>{const B=pick([100,500,1000]),delta=ri(1,5)*(chance()?1:-1),b=ri(20,499);return intTask("1.6-D","CORE",`${B+delta} + ${b} = ?`,B+delta+b);}},
  {id:"1.6-E",difficulty:"CHALLENGE",make:()=>{const total=pick([20,50,100,200]),a=ri(2,total-2),b=total-a,k=pick([4,5,10,20,25,50]);return intTask("1.6-E","CHALLENGE",`${a} × ${k} + ${b} × ${k} = ?`,total*k);}},
  {id:"1.6-F",difficulty:"CHALLENGE",make:()=>{const B=pick([50,100,200]),d=ri(1,9),k=ri(3,60);return intTask("1.6-F","CHALLENGE",`${B+d} × ${k} − ${d} × ${k} = ?`,B*k);}},
  {id:"1.6-G",difficulty:"CORE",make:()=>{const k=ri(3,9),tens=ri(2,9)*10,ones=ri(1,9),n=tens+ones;return intTask("1.6-G","CORE",`${k} × ${n} = ${k} × ${tens} + ?`,k*ones,{decomposition:`${k}×${tens}+${k}×${ones}`});}},
  {id:"1.6-H",difficulty:"CHALLENGE",make:()=>{const B=pick([100,500,1000]),d1=ri(1,5),d2=ri(1,5),a=B+d1,b=B-d2;return intTask("1.6-H","CHALLENGE",`${a} − ${b} = ?`,d1+d2);}},
];}
export function templates17():Template[]{return [
  {id:"1.7-A",difficulty:"BASIC",make:()=>{const a=ri(2,20);return intTask("1.7-A","BASIC",`${a}² = ?`,a*a);}},
  {id:"1.7-B",difficulty:"CORE",make:()=>{const a=ri(2,10);return intTask("1.7-B","CORE",`${a}³ = ?`,a*a*a);}},
  {id:"1.7-C",difficulty:"CORE",make:()=>{const a=ri(2,5),e=ri(4,5);return intTask("1.7-C","CORE",`${a}^${e} = ?`,a**e);}},
  {id:"1.7-D",difficulty:"CORE",make:()=>{const a=ri(2,20),e=chance()?2:3;return intTask("1.7-D","CORE",`?^${e} = ${a**e}`,a);}},
  {id:"1.7-E",difficulty:"CHALLENGE",make:()=>{const a=ri(2,8),b=ri(2,8),m=ri(2,4),n=ri(2,4),plus=chance();const A=a**m,B=b**n;const ans=plus?A+B:Math.abs(A-B);return intTask("1.7-E","CHALLENGE",`${Math.max(A,B)===A?a:b}^${Math.max(A,B)===A?m:n} ${plus?"+":"−"} ${Math.max(A,B)===A?`${b}^${n}`:`${a}^${m}`} = ?`,ans);}},
  {id:"1.7-F",difficulty:"BASIC",make:()=>{const a=ri(2,9),e=ri(3,6);return intTask("1.7-F","BASIC",`${Array(e).fill(a).join(" × ")} = ${a}^?`,e);}},
  {id:"1.7-G",difficulty:"CORE",make:()=>{const e=ri(2,6);return intTask("1.7-G","CORE",`10^${e} = ?`,10**e);}},
];}
