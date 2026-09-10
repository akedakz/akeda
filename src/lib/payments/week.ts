const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export function currentAlmatyDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Almaty",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function mondayOf(date: string) {
  if (!datePattern.test(date)) return null;
  const value = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(value.getTime()) || value.toISOString().slice(0, 10) !== date) return null;
  const weekday = value.getUTCDay() || 7;
  return addDays(date, 1 - weekday);
}

export function isMonday(date: string) {
  return mondayOf(date) === date;
}
