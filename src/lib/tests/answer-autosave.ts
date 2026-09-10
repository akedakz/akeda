import type { StudentAnswer } from "./student-test-types";

export const answerConflictMessage = "Ответ изменён в другой вкладке. Обновите страницу, чтобы продолжить. Ваш ответ пока не сохранён.";
export type AnswerSaveResult =
  | { ok: true; status: "saved" | "already_current"; currentRevision: number; message: string }
  | { ok: false; status?: "conflict" | "closed"; message: string; deadlinePassed?: boolean };
export type AnswerSaveState = "saved" | "saving" | "error" | "conflict";

// Fail closed on an old boolean RPC response or an unexpected contract.
export function interpretAnswerSaveResult(value: unknown): AnswerSaveResult {
  const row = value as { status?: unknown; current_revision?: unknown } | null;
  if (row?.status === "conflict") return { ok: false, status: "conflict", message: answerConflictMessage };
  if (row?.status === "closed") return { ok: false, status: "closed", message: "Срок истёк или попытка уже завершена. Ответ не изменён.", deadlinePassed: true };
  if ((row?.status === "saved" || row?.status === "already_current") && typeof row.current_revision === "number" && Number.isSafeInteger(row.current_revision) && row.current_revision >= 0) {
    return { ok: true, status: row.status, currentRevision: row.current_revision, message: "Сохранено" };
  }
  return { ok: false, message: "Не удалось подтвердить сохранение ответа." };
}

// One request per question at a time. Local edits never advance the DB revision.
export class AnswerAutosave {
  readonly dirty = new Map<string, StudentAnswer>();
  readonly revisions: Map<string, number>;
  private running = new Map<string, Promise<boolean>>();
  private failures = new Set<string>();
  private conflicted = false;
  private save: (key: string, answer: StudentAnswer, expectedRevision: number) => Promise<AnswerSaveResult>;
  private notify: (state: AnswerSaveState) => void;

  constructor(
    initialRevisions: Record<string, number>,
    save: (key: string, answer: StudentAnswer, expectedRevision: number) => Promise<AnswerSaveResult>,
    notify: (state: AnswerSaveState) => void = () => {},
  ) {
    this.revisions = new Map(Object.entries(initialRevisions));
    this.save = save;
    this.notify = notify;
  }

  get state(): AnswerSaveState {
    return this.conflicted ? "conflict" : this.failures.size ? "error" : this.dirty.size ? "saving" : "saved";
  }

  edit(key: string, answer: StudentAnswer) {
    this.dirty.set(key, answer);
    this.failures.delete(key);
    this.notify(this.state);
  }

  markConflict() { this.conflicted = true; this.notify(this.state); }

  persist(key: string): Promise<boolean> {
    if (this.conflicted) return Promise.resolve(false);
    const pending = this.running.get(key);
    if (pending) return pending;
    const operation = this.drain(key).finally(() => { this.running.delete(key); });
    this.running.set(key, operation);
    return operation;
  }

  private async drain(key: string): Promise<boolean> {
    while (this.dirty.has(key) && !this.conflicted) {
      const answer = this.dirty.get(key)!;
      this.failures.delete(key);
      this.notify(this.state);
      let result: AnswerSaveResult;
      try { result = await this.save(key, answer, this.revisions.get(key) ?? 0); }
      catch { result = { ok: false, message: "Не удалось сохранить ответ." }; }
      if (!result.ok) {
        if (result.status === "conflict") this.conflicted = true;
        else this.failures.add(key);
        this.notify(this.state);
        return false;
      }
      this.revisions.set(key, result.currentRevision);
      if (this.dirty.get(key) === answer) this.dirty.delete(key);
      this.notify(this.state);
    }
    return !this.conflicted;
  }

  async flush(answers: Record<string, StudentAnswer>): Promise<boolean> {
    if (this.conflicted) return false;
    // Also verify hydrated/previously saved answers before explicit submit.
    for (const [key, answer] of Object.entries(answers)) this.edit(key, answer);
    const results = await Promise.all([...this.dirty.keys()].map((key) => this.persist(key)));
    return results.every(Boolean) && this.state === "saved";
  }
}
