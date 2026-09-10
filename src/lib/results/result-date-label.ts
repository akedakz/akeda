import "server-only";

const RU_MONTHS_GENITIVE = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
] as const;

const almatyDateParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Almaty",
  year: "numeric",
  month: "numeric",
  day: "numeric",
});

export function formatResultDateLabel(dateIso: string): string {
  const parts = almatyDateParts.formatToParts(new Date(dateIso));
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12
  ) {
    throw new Error("Некорректная дата результата");
  }

  return `${day} ${RU_MONTHS_GENITIVE[month - 1]} ${year}`;
}
