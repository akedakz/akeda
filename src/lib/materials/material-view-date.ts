import "server-only";

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"] as const;
const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function formatMaterialViewDate(value: string) {
  const parts = formatter.formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const day = Number(get("day"));
  const month = Number(get("month"));
  const hour = get("hour").padStart(2, "0");
  const minute = get("minute").padStart(2, "0");
  if (!day || month < 1 || month > 12 || !hour || !minute) throw new Error("Некорректная дата просмотра материала");
  return `${day} ${MONTHS[month - 1]}, ${hour}:${minute}`;
}
