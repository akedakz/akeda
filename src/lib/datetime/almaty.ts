export const applicationTimeZone = "Asia/Almaty";

const partsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: applicationTimeZone,
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

function parts(date: Date) {
  return Object.fromEntries(partsFormatter.formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)])) as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
}

export function almatyLocalDateTimeToIso(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;
  for (let index = 0; index < 2; index += 1) {
    const seen = parts(new Date(guess));
    guess += target - Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second);
  }
  const result = new Date(guess);
  const seen = parts(result);
  return seen.year === year && seen.month === month && seen.day === day && seen.hour === hour && seen.minute === minute ? result.toISOString() : null;
}

export function defaultAlmatyDeadline() {
  const now = parts(new Date());
  const date = new Date(Date.UTC(now.year, now.month - 1, now.day + 7));
  return `${date.toISOString().slice(0, 10)}T18:00`;
}
