import {
  type Template, type Rat, R, canonical, add, sub, mul, div, finiteScale, displayFraction, displayDecimal,
  task, intTask, pick, chance, ri, shuffle, makeFraction, makeNonIntegerFraction, nonIntegerDecimal, uniqueIntegers
} from "./section1-generator-core";

export function templates18():Template[]{return [
  {id:"1.8-A",difficulty:"BASIC",make:()=>{const whole=ri(0,99),scale=pick([1,2,3]),frac=ri(1,10**scale-1);const r=R(whole*10**scale+frac,10**scale);const word=scale===1?"десятых":scale===2?"сотых":"тысячных";return task("1.8-A","BASIC",`Запишите десятичной дробью: ${whole} целых ${frac} ${word}.`,r,displayDecimal(r,scale));}},
  {id:"1.8-B",difficulty:"BASIC",make:()=>{const scale=ri(2,4),value=ri(10**(scale-1),10**scale-1),whole=ri(0,30),pos=ri(1,Math.min(scale,3));const digits=String(value).padStart(scale,"0"),digit=Number(digits[pos-1]);const name=pos===1?"десятых":pos===2?"сотых":"тысячных";return intTask("1.8-B","BASIC",`Какая цифра стоит в разряде ${name} в числе ${whole},${digits}?`,digit);}},
  {id:"1.8-C",difficulty:"CORE",make:()=>{const scale=3,whole=ri(0,20),pos=ri(1,3),digit=ri(1,9),digits=Array.from({length:scale},(_,i)=>i===pos-1?String(digit):String(ri(0,9))).join("");const ans=R(digit,10**pos);return task("1.8-C","CORE",`Каково значение цифры ${digit} в числе ${whole},${digits}?`,ans,displayDecimal(ans,pos));}},
  {id:"1.8-D",difficulty:"CORE",make:()=>{const whole=ri(0,20),a=ri(1,9)*10,b=ri(1,99);const ra=R(whole*100+a,100),rb=R(whole*100+b,100);if(canonical(ra)===canonical(rb))return templates18()[3].make();const greater=ra.n*rb.d>rb.n*ra.d?ra:rb;return task("1.8-D","CORE",`Какое число больше: ${displayDecimal(ra,1)} или ${displayDecimal(rb,2)}?`,greater,displayDecimal(greater));}},
  {id:"1.8-E",difficulty:"CHALLENGE",make:()=>{const whole=ri(0,9),base=ri(10,89),a=R(whole*1000+base*10+ri(0,9),1000),b=R(whole*100+base,100),c=R(whole*10000+base*100+ri(0,99),10000);const vals=shuffle([a,b,c]);let min=vals[0];for(const x of vals)if(x.n*min.d<min.n*x.d)min=x;return task("1.8-E","CHALLENGE",`Какое число наименьшее: ${vals.map(v=>displayDecimal(v)).join("; ")}?`,min,displayDecimal(min));}},
  {id:"1.8-F",difficulty:"CHALLENGE",make:()=>{const whole=ri(0,50),d1=ri(1,9),d3=ri(1,9),r=R(whole*1000+d1*100+d3,1000);return task("1.8-F","CHALLENGE",`Запишите числом: ${whole} + ${d1}/10 + ${d3}/1000.`,r,displayDecimal(r,3));}},
  {id:"1.8-G",difficulty:"CORE",make:()=>{const whole=ri(0,20);const vals:Rat[]=[];while(vals.length<3){const r=R(whole*1000+ri(1,999),1000);if(!vals.some(v=>canonical(v)===canonical(r)))vals.push(r);}const sorted=[...vals].sort((u,v)=>Number(u.n*v.d-v.n*u.d));const mid=sorted[1];return task("1.8-G","CORE",`Какое число стоит посередине по величине: ${vals.map(v=>displayDecimal(v)).join("; ")}?`,mid,displayDecimal(mid));}},
  {id:"1.8-H",difficulty:"BASIC",make:()=>{const value=ri(1,999),scale=ri(1,3),r=R(value,10**scale);const extra=ri(1,2);return task("1.8-H","BASIC",`Запишите число ${displayDecimal(r,scale+extra)} без лишних нулей в конце.`,r,displayDecimal(r));}},
];}
export function templates19():Template[]{return [
  {id:"1.9-A",difficulty:"BASIC",make:()=>{const s1=ri(1,2),s2=ri(1,2),a=ri(1,99*10**s1),b=ri(1,99*10**s2),ra=R(a,10**s1),rb=R(b,10**s2),ans=add(ra,rb);return task("1.9-A","BASIC",`${displayDecimal(ra,s1)} + ${displayDecimal(rb,s2)} = ?`,ans,displayDecimal(ans));}},
  {id:"1.9-B",difficulty:"BASIC",make:()=>{const s1=ri(1,2),s2=ri(1,2),a=ri(10,9999),b=ri(1,999),ra=R(a,10**s1),rb=R(b,10**s2);const [x,y]=ra.n*rb.d>=rb.n*ra.d?[ra,rb]:[rb,ra];const ans=sub(x,y);return task("1.9-B","BASIC",`${displayDecimal(x)} − ${displayDecimal(y)} = ?`,ans,displayDecimal(ans));}},
  {id:"1.9-C",difficulty:"CORE",make:()=>{const s=ri(1,2),a=ri(2,200),n=ri(2,12),ra=R(a,10**s),ans=mul(ra,R(n));return task("1.9-C","CORE",`${displayDecimal(ra,s)} × ${n} = ?`,ans,displayDecimal(ans));}},
  {id:"1.9-D",difficulty:"CORE",make:()=>{const a=R(ri(2,200),10),b=R(ri(2,200),10),ans=mul(a,b);return task("1.9-D","CORE",`${displayDecimal(a,1)} × ${displayDecimal(b,1)} = ?`,ans,displayDecimal(ans));}},
  {id:"1.9-E",difficulty:"CORE",make:()=>{const d=ri(2,12),q=R(ri(1,999),100),dividend=mul(q,R(d));return task("1.9-E","CORE",`${displayDecimal(dividend)} ÷ ${d} = ?`,q,displayDecimal(q));}},
  {id:"1.9-F",difficulty:"CHALLENGE",make:()=>{const d=R(ri(2,9),10),q=R(ri(2,30)),dividend=mul(q,d);return task("1.9-F","CHALLENGE",`${displayDecimal(dividend)} ÷ ${displayDecimal(d,1)} = ?`,q,displayDecimal(q));}},
  {id:"1.9-G",difficulty:"CHALLENGE",make:()=>{const d=pick([R(1,5),R(2,5),R(1,2),R(4,5),R(5,4),R(5,2)]),q=R(ri(2,200),10),dividend=mul(q,d);return task("1.9-G","CHALLENGE",`${displayDecimal(dividend)} ÷ ${displayDecimal(d)} = ?`,q,displayDecimal(q));}},
  {id:"1.9-H",difficulty:"CHALLENGE",make:()=>{const a=R(ri(2,99),10),q=R(ri(2,90),10),product=mul(a,q);return task("1.9-H","CHALLENGE",`${displayDecimal(a,1)} × ? = ${displayDecimal(product)}. Найдите пропущенный множитель.`,q,displayDecimal(q));}},
];}
export function templates110():Template[]{return [
  {id:"1.10-A",difficulty:"BASIC",make:()=>{const d=pick([2,4,5,8,10,20,25,40,50,100]),n=ri(1,d-1),r=R(n,d);return task("1.10-A","BASIC",`${displayFraction(r)} = ? (десятичной дробью)`,r,displayDecimal(r));}},
  {id:"1.10-B",difficulty:"CORE",make:()=>{const baseD=pick([2,4,5,8,10,20,25]),n=ri(1,baseD-1),g=ri(2,6),r=R(n,baseD);return task("1.10-B","CORE",`${n*g}/${baseD*g} = ? (десятичной дробью)`,r,displayDecimal(r));}},
  {id:"1.10-C",difficulty:"CORE",make:()=>{const d=pick([2,4,5,8,10,20]),whole=ri(1,9),n=whole*d+ri(1,d-1),r=R(n,d);return task("1.10-C","CORE",`${n}/${d} = ? (десятичной дробью)`,r,displayDecimal(r));}},
  {id:"1.10-D",difficulty:"BASIC",make:()=>{const scale=ri(1,2),value=ri(1,10**scale-1),r=R(value,10**scale);return task("1.10-D","BASIC",`${displayDecimal(r,scale)} = ? (обыкновенной дробью)`,r,displayFraction(r));}},
  {id:"1.10-E",difficulty:"CORE",make:()=>{const scale=ri(2,3),whole=ri(1,9);let r=R(whole*10**scale+ri(1,10**scale-1),10**scale);while(r.d>BigInt(100))r=R(whole*10**scale+ri(1,10**scale-1),10**scale);return task("1.10-E","CORE",`${displayDecimal(r,scale)} = ? (обыкновенной дробью)`,r,displayFraction(r));}},
  {id:"1.10-F",difficulty:"CHALLENGE",make:()=>{let r=R(ri(100,4999),1000);while(r.d>BigInt(40))r=R(ri(100,4999),1000);return task("1.10-F","CHALLENGE",`${displayDecimal(r,3)} = ? (обыкновенной дробью)`,r,displayFraction(r));}},
  {id:"1.10-G",difficulty:"CHALLENGE",make:()=>{const whole=ri(1,9),d0=pick([2,4,5,8,10,20]),f=R(ri(1,d0-1),d0),r=add(R(whole),f);const n=Number(f.n),d=Number(f.d);return task("1.10-G","CHALLENGE",`${whole} ${n}/${d} = ? (десятичной дробью)`,r,displayDecimal(r));}},
];}
function recurringFraction(integerPart:number,nonRep:string,rep:string){ const n=nonRep.length,m=rep.length;const A=BigInt(`${integerPart}${nonRep}${rep}`),B=BigInt(`${integerPart}${nonRep}`);const den=(BigInt(10)**BigInt(n))*(BigInt(10)**BigInt(m)-BigInt(1));return R(A-B,den); }
export function templates111():Template[]{return [
  {id:"1.11-A",difficulty:"BASIC",make:()=>{const d=ri(1,8),r=R(d,9);return task("1.11-A","BASIC",`0,(${d}) = ? (обыкновенной дробью)`,r,displayFraction(r));}},
  {id:"1.11-B",difficulty:"CORE",make:()=>{let p=ri(10,98);if(p===99)p=98;const r=R(p,99);return task("1.11-B","CORE",`0,(${p}) = ? (обыкновенной дробью)`,r,displayFraction(r));}},
  {id:"1.11-C",difficulty:"CORE",make:()=>{const a=ri(0,8),b=ri(1,8),r=recurringFraction(0,String(a),String(b));return task("1.11-C","CORE",`0,${a}(${b}) = ? (обыкновенной дробью)`,r,displayFraction(r));}},
  {id:"1.11-D",difficulty:"CORE",make:()=>{const nr=String(ri(10,98)).padStart(2,"0"),b=ri(1,8),r=recurringFraction(0,nr,String(b));return task("1.11-D","CORE",`0,${nr}(${b}) = ? (обыкновенной дробью)`,r,displayFraction(r));}},
  {id:"1.11-E",difficulty:"CHALLENGE",make:()=>{const k=ri(1,5),d=ri(1,8),r=recurringFraction(k,"",String(d));return task("1.11-E","CHALLENGE",`${k},(${d}) = ? (обыкновенной дробью)`,r,displayFraction(r));}},
  {id:"1.11-F",difficulty:"CHALLENGE",make:()=>{const k=ri(1,5),a=ri(0,8),p=String(ri(10,98)),r=recurringFraction(k,String(a),p);return task("1.11-F","CHALLENGE",`${k},${a}(${p}) = ? (обыкновенной дробью)`,r,displayFraction(r));}},
  {id:"1.11-G",difficulty:"CORE",make:()=>{const p=String(ri(100,998)),r=R(Number(p),999);return task("1.11-G","CORE",`0,(${p}) = ? (обыкновенной дробью)`,r,displayFraction(r));}},
  {id:"1.11-H",difficulty:"CHALLENGE",make:()=>{const a=ri(0,8),p=String(ri(10,98)),r=recurringFraction(0,String(a),p);return task("1.11-H","CHALLENGE",`0,${a}(${p}) = ? (обыкновенной дробью)`,r,displayFraction(r));}},
];}
export function templates112():Template[]{return [
  {id:"1.12-A",difficulty:"BASIC",make:()=>{const scale=ri(1,3),r=R(ri(1,99999),10**scale),m=pick([10,100,1000]);const ans=mul(r,R(m));return task("1.12-A","BASIC",`${displayDecimal(r,scale)} × ${m} = ?`,ans,displayDecimal(ans));}},
  {id:"1.12-B",difficulty:"CORE",make:()=>{const scale=ri(0,2),r=R(ri(10,100000),10**scale),d=pick([10,100,1000]);const ans=div(r,R(d));return task("1.12-B","CORE",`${displayDecimal(r,scale)} ÷ ${d} = ?`,ans,displayDecimal(ans));}},
  {id:"1.12-C",difficulty:"CORE",make:()=>{const scale=ri(0,2),r=R(ri(10,100000),10**scale),k=pick([1,2,3]),m=R(1,10**k),ans=mul(r,m);return task("1.12-C","CORE",`${displayDecimal(r,scale)} × ${displayDecimal(m,k)} = ?`,ans,displayDecimal(ans));}},
  {id:"1.12-D",difficulty:"CHALLENGE",make:()=>{const scale=ri(1,3),k=pick([1,2,3]),maxValue=Math.floor(100000/10**k),r=R(ri(1,Math.max(1,maxValue*10**scale)),10**scale),d=R(1,10**k),ans=div(r,d);return task("1.12-D","CHALLENGE",`${displayDecimal(r,scale)} ÷ ${displayDecimal(d,k)} = ?`,ans,displayDecimal(ans));}},
  {id:"1.12-E",difficulty:"CHALLENGE",make:()=>{const r=R(ri(1,999),1000),m=pick([10,100,1000]),ans=mul(r,R(m));return task("1.12-E","CHALLENGE",`${displayDecimal(r,3)} × ${m} = ?`,ans,displayDecimal(ans));}},
  {id:"1.12-F",difficulty:"CORE",make:()=>{const base=R(ri(1,9999),100),m=pick([10,100,1000]);const result=mul(base,R(m));return intTask("1.12-F","CORE",`${displayDecimal(base,2)} × ? = ${displayDecimal(result)}. Найдите множитель.`,m);}},
];}
function roundHalfUp(r:Rat,scale:number){ const factor=BigInt(10)**BigInt(scale); const num=r.n*factor; const q=num/r.d; const rem=num%r.d; const sign=r.n<BigInt(0)?-BigInt(1):BigInt(1); const ar=rem<BigInt(0)?-rem:rem; const rounded=ar*BigInt(2)>=r.d?q+sign:q; return R(rounded,factor); }
export function templates113():Template[]{return [
  {id:"1.13-A",difficulty:"BASIC",make:()=>{const place=pick([10,100,1000]),n=ri(100,999999),ans=Math.floor((n+place/2)/place)*place;const word=place===10?"десятков":place===100?"сотен":"тысяч";return intTask("1.13-A","BASIC",`Округлите ${n} до ${word}.`,ans);}},
  {id:"1.13-B",difficulty:"BASIC",make:()=>{const r=R(ri(1,9999),10),ans=roundHalfUp(r,0);return task("1.13-B","BASIC",`Округлите ${displayDecimal(r,1)} до целых.`,ans,String(ans.n));}},
  {id:"1.13-C",difficulty:"CORE",make:()=>{const r=R(ri(1,9999),100),ans=roundHalfUp(r,1);return task("1.13-C","CORE",`Округлите ${displayDecimal(r,2)} до десятых.`,ans,displayDecimal(ans,1));}},
  {id:"1.13-D",difficulty:"CORE",make:()=>{const r=R(ri(1,999999),1000),ans=roundHalfUp(r,2);return task("1.13-D","CORE",`Округлите ${displayDecimal(r,3)} до сотых.`,ans,displayDecimal(ans,2));}},
  {id:"1.13-E",difficulty:"CORE",make:()=>{const place=pick([1000,10000]),n=ri(10000,999999),ans=Math.floor((n+place/2)/place)*place;const word=place===1000?"тысяч":"десятков тысяч";return intTask("1.13-E","CORE",`Округлите ${n} до ${word}.`,ans);}},
  {id:"1.13-F",difficulty:"CHALLENGE",make:()=>{const whole=ri(1,20),r=R(whole*1000+995,1000),ans=roundHalfUp(r,2);return task("1.13-F","CHALLENGE",`Округлите ${displayDecimal(r,3)} до сотых.`,ans,displayDecimal(ans,2));}},
];}
export function templates114():Template[]{return [
  {id:"1.14-A",difficulty:"BASIC",make:()=>{const a=ri(1,20),d=nonIntegerDecimal(1,10),m=ri(2,9),ans=add(R(a),mul(d,R(m)));return task("1.14-A","BASIC",`${a} + ${displayDecimal(d,1)} × ${m} = ?`,ans,answerDisplay(ans));}},
  {id:"1.14-B",difficulty:"BASIC",make:()=>{const f=makeNonIntegerFraction(20,false),d=nonIntegerDecimal(2,5),ans=add(f,d);return task("1.14-B","BASIC",`${displayFraction(f)} + ${displayDecimal(d)} = ?`,ans,answerDisplay(ans));}},
  {id:"1.14-C",difficulty:"CORE",make:()=>{const i=ri(2,10),f=makeFraction(12),m=ri(2,6),plus=chance(),inside=plus?add(R(i),f):sub(R(i),f),ans=mul(inside,R(m));return task("1.14-C","CORE",`(${i} ${plus?"+":"−"} ${displayFraction(f)}) × ${m} = ?`,ans,answerDisplay(ans));}},
  {id:"1.14-D",difficulty:"CORE",make:()=>{const d=nonIntegerDecimal(1,1),q=ri(2,20),dividend=mul(d,R(q)),f=makeNonIntegerFraction(10,false),ans=sub(R(q),f);return task("1.14-D","CORE",`${displayDecimal(dividend)} ÷ ${displayDecimal(d,1)} − ${displayFraction(f)} = ?`,ans,answerDisplay(ans));}},
  {id:"1.14-E",difficulty:"CORE",make:()=>{const i=ri(1,9),den=pick([2,4,5,10]),num=ri(1,den-1),m=den,d=R(ri(2,99),10),ans=sub(add(R(i),mul(R(num,den),R(m))),d);return task("1.14-E","CORE",`${i} + ${num}/${den} × ${m} − ${displayDecimal(d,1)} = ?`,ans,answerDisplay(ans));}},
  {id:"1.14-F",difficulty:"CHALLENGE",make:()=>{const d=nonIntegerDecimal(2,5),f=makeNonIntegerFraction(10,true),m=ri(2,8),ans=mul(add(d,f),R(m));return task("1.14-F","CHALLENGE",`(${displayDecimal(d)} + ${displayFraction(f)}) × ${m} = ?`,ans,answerDisplay(ans));}},
  {id:"1.14-G",difficulty:"CHALLENGE",make:()=>{const i=ri(1,10),f=makeNonIntegerFraction(10,true),d=nonIntegerDecimal(2,5),m=ri(2,5),ans=add(sub(R(i),f),mul(d,R(m)));return task("1.14-G","CHALLENGE",`${i} − ${displayFraction(f)} + ${displayDecimal(d)} × ${m} = ?`,ans,answerDisplay(ans));}},
  {id:"1.14-H",difficulty:"CHALLENGE",make:()=>{const q=R(ri(1,20),pick([1,2,4,5])),d=R(ri(2,9),10),inside=mul(q,d),whole=Math.ceil(Number(inside.n)/Number(inside.d))+ri(1,4),f=sub(R(whole),inside);return task("1.14-H","CHALLENGE",`(${whole} − ${displayFraction(f)}) ÷ ${displayDecimal(d,1)} = ?`,q,answerDisplay(q));}},
  {id:"1.14-I",difficulty:"CHALLENGE",make:()=>{const i=-ri(2,15),f=makeNonIntegerFraction(10,false),d=nonIntegerDecimal(1,10),ans=add(add(R(i),f),d);return task("1.14-I","CHALLENGE",`${i} + ${displayFraction(f)} + ${displayDecimal(d,1)} = ?`,ans,answerDisplay(ans));}},
  {id:"1.14-J",difficulty:"CHALLENGE",make:()=>{const a=nonIntegerDecimal(1,5),b=makeNonIntegerFraction(10,true),c=ri(2,8),d=ri(1,9),ans=sub(mul(add(a,b),R(c)),R(d));return task("1.14-J","CHALLENGE",`(${displayDecimal(a,1)} + ${displayFraction(b)}) × ${c} − ${d} = ?`,ans,answerDisplay(ans));}},
];}
function answerDisplay(a:Rat){ const s=finiteScale(a); return s!==null && s<=3 ? displayDecimal(a) : displayFraction(a); }
