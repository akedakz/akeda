export type FinanceEntryType = "PAYMENT" | "LESSON_CHARGE" | "ADJUSTMENT";

export type StudentFinanceEntry = {
  id: string;
  type: FinanceEntryType;
  amountKzt: number;
  lessonId: string | null;
  durationMinutes: number | null;
  ratePer60Kzt: number | null;
  note: string | null;
  createdAt: string;
};

export type StudentFinanceSummary = {
  ratePer60Kzt: number | null;
  billingStartedAt: string | null;
  balanceKzt: number;
  remainingLessonEquivalents: number | null;
  entries: StudentFinanceEntry[];
};

export const formatKzt = (value: number) => `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value)} ₸`;
export const formatLessonEquivalents = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value);
