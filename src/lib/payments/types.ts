export type WeeklyPaymentRow = {
  id: string;
  student_name: string;
  subject: string;
  price_per_lesson_kzt: number;
  lessons_count: number;
  amount_due_kzt: number;
  paid: boolean;
  paid_at: string | null;
  notes: string | null;
  sort_order: number;
};

export type WeeklyPaymentsDashboard = {
  status: "ok";
  rows: WeeklyPaymentRow[];
  selected_week: { due_kzt: number; received_kzt: number; remaining_kzt: number; percentage: number };
  actual_received: { week_kzt: number; month_kzt: number; year_kzt: number };
  students: { name: string; total_paid_kzt: number; last_paid_at: string }[];
};

export function formatKzt(value: number) {
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value)} ₸`;
}
