import { answerIsFilled, gradeStudentAttempt } from "@/lib/tests/grade-student-attempt";
import type { LegacySnapshotQuestion, TestSnapshot, TestSnapshotPart, TestSnapshotQuestion } from "@/lib/tests/test-snapshot-types";
import type { BaseStudentAnswer, StudentAnswer } from "@/lib/tests/student-test-types";
import MathText from "./math-text";
import QuestionImage from "./question-image";
import styles from "./test-attempt-review.module.css";

type SavedGrading = { isCorrect: boolean | null; pointsAwarded: number | null };
type Props = { snapshot: TestSnapshot; answers: Map<string, StudentAnswer>; imageUrls?: Record<string, string>; showCorrect: boolean; admin?: boolean; rawAnswers?: Map<string, unknown>; gradingByQuestion?: Map<string, SavedGrading> };

export default function TestAttemptReview({ snapshot, answers, imageUrls = {}, showCorrect, admin = false, rawAnswers = new Map(), gradingByQuestion = new Map() }: Props) {
  const result = gradeStudentAttempt(snapshot, answers);
  return <section className={styles.review}><h2>Ответы по вопросам</h2>{snapshot.questions.map((question, index) => {
    const answer = answers.get(question.key); const raw = rawAnswers.get(question.key); const calculated = result.reviews[index]; const saved = gradingByQuestion.get(question.key); const filled = admin ? rawFilled(raw) : answerIsFilled(answer); const points = saved?.pointsAwarded ?? calculated.points; const correct = saved?.isCorrect ?? calculated.isCorrect; const status = !filled ? "Пропущено" : saved?.isCorrect === null ? "Требует проверки" : correct ? "Правильно" : points > 0 ? "Частично правильно" : "Неправильно";
    return <article className={!filled ? styles.skipped : correct ? styles.correctCard : styles.incorrectCard} key={question.key}><header><span>Вопрос {index + 1}</span><b>{points}/{question.points} балла</b><i>{status}</i></header><h3><MathText>{question.prompt || "Вопрос с изображением"}</MathText></h3>{question.imagePath && imageUrls[question.imagePath] && <QuestionImage src={imageUrls[question.imagePath]} />}<QuestionReview question={question} answer={answer} raw={raw} showCorrect={admin || showCorrect}/></article>;
  })}</section>;
}

function QuestionReview({ question, answer, raw, showCorrect }: { question: TestSnapshotQuestion; answer?: StudentAnswer; raw: unknown; showCorrect: boolean }) {
  if (question.type === "MATCHING") { const matches = answer?.type === "MATCHING" ? answer.matches : {}; return <dl className={styles.answerBlocks}>{question.matching.leftItems.map((item) => { const chosen = question.matching.options.find((option) => option.key === matches[item.key]); const correct = question.matching.options.find((option) => option.key === item.correctOptionKey); return <div key={item.key}><dt>{item.label}. <MathText>{item.text}</MathText></dt><dd>Ответ ученика: <MathText>{chosen ? `${chosen.label}. ${chosen.text}` : "—"}</MathText>{showCorrect && <><br/>Правильный: <MathText>{correct ? `${correct.label}. ${correct.text}` : "—"}</MathText></>}</dd></div>; })}</dl>; }
  if (question.type === "MULTI_PART") { const parts = answer?.type === "MULTI_PART" ? answer.parts : {}; return <dl className={styles.answerBlocks}>{question.multiPart.parts.map((part) => <div key={part.key}><dt>{part.label}) <MathText>{part.prompt}</MathText></dt><dd>Ответ ученика: <MathText>{String(baseAnswerText(part, parts[part.key]))}</MathText>{showCorrect && <><br/>Правильный: <MathText>{String(baseCorrectText(part))}</MathText></>}</dd></div>)}</dl>; }
  const baseAnswer = answer?.type === "MATCHING" || answer?.type === "MULTI_PART" ? undefined : answer;
  return <dl className={styles.answerBlocks}><div><dt>Ответ ученика</dt><dd><MathText>{String(baseAnswerText(question, baseAnswer) || rawText(raw))}</MathText></dd></div>{showCorrect && <div><dt>Правильный ответ</dt><dd><MathText>{String(baseCorrectText(question))}</MathText></dd></div>}</dl>;
}

function baseAnswerText(question: LegacySnapshotQuestion | TestSnapshotPart, answer?: BaseStudentAnswer) { if (question.type === "NUMERIC" && answer?.type === "NUMERIC") return answer.value ?? "—"; if (question.type === "SINGLE_CHOICE" && answer?.type === "SINGLE_CHOICE") return question.options.find((option) => option.key === answer.optionKey)?.text ?? "—"; if (question.type === "MULTIPLE_CHOICE" && answer?.type === "MULTIPLE_CHOICE") return answer.optionKeys.map((key) => question.options.find((option) => option.key === key)?.text).filter(Boolean).join("; ") || "—"; return "—"; }
function baseCorrectText(question: LegacySnapshotQuestion | TestSnapshotPart) { if (question.type !== "NUMERIC") return question.options.filter((option) => option.isCorrect).map((option) => option.text).join("; ") || "—"; const numeric = question.numeric; if (numeric.mode === "TOLERANCE") return `${numeric.exactValue} ± ${numeric.tolerance}`; if (numeric.mode === "RANGE") return `${numeric.rangeMin}–${numeric.rangeMax}`; return String(numeric.exactValue ?? "—"); }
function rawFilled(value: unknown) { if (value === null || value === undefined || value === "") return false; if (Array.isArray(value)) return value.length > 0; return typeof value !== "object" || Object.keys(value).length > 0; }
function rawText(value: unknown) { return rawFilled(value) ? "Ответ сохранён" : "—"; }
