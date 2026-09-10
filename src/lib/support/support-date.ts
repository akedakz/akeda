import "server-only";
const months=["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"] as const;
const formatter=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Almaty",year:"numeric",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
export function formatSupportDate(value:string,full=false){const parts=formatter.formatToParts(new Date(value));const get=(type:Intl.DateTimeFormatPartTypes)=>parts.find(part=>part.type===type)?.value??"";const day=Number(get("day")),month=Number(get("month")),year=get("year"),hour=get("hour").padStart(2,"0"),minute=get("minute").padStart(2,"0");return `${day} ${months[month-1]}${full?` ${year}`:""}, ${hour}:${minute}`}
