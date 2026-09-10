export const TRAINER_TYPE_UI = {
  QUICK_PROBLEMS: {
    sortOrder: 0,
    label: "Quick Problems",
    description: "Быстрые задачи по формулам",
    adminHref: "/admin/trainers/quick-problems",
    studentHref: "/student/trainers/quick-problems",
  },
  THEORY: {
    sortOrder: 1,
    label: "Theory",
    description: "Теория и понимание физики",
    adminHref: "/admin/trainers/theory",
    studentHref: "/student/trainers/theory",
  },
  FORMULA_RECALL: {
    sortOrder: 2,
    label: "Formula Recall",
    description: "Библиотека физических формул",
    adminHref: "/admin/trainers/formula-recall",
    studentHref: "/student/trainers/formula-recall",
  },
} as const;
