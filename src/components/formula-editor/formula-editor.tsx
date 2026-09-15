"use client";

import type { MathfieldElement as MathfieldElementType, Selection } from "mathlive";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import "mathlive/fonts.css";
import styles from "./formula-editor.module.css";

export type FormulaEditorProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  readOnly?: boolean;
  allowPaste?: boolean;
  maxExpressionLength?: number;
  className?: string;
};

type InsertKind = "text" | "fraction" | "square" | "power" | "subscript" | "root" | "nthRoot" | "parentheses";

const SYMBOLS = [
  ["π", "\\pi"], ["Δ", "\\Delta"], ["θ", "\\theta"], ["λ", "\\lambda"],
  ["μ", "\\mu"], ["ρ", "\\rho"], ["ν", "\\nu"], ["ω", "\\omega"],
  ["α", "\\alpha"], ["β", "\\beta"], ["γ", "\\gamma"], ["ε", "\\varepsilon"], ["φ", "\\varphi"],
] as const;

const BUTTONS: ReadonlyArray<{ label: string; title: string; kind: InsertKind; value?: string }> = [
  { label: "+", title: "Плюс", kind: "text", value: "+" },
  { label: "−", title: "Минус", kind: "text", value: "-" },
  { label: "×", title: "Умножение", kind: "text", value: "\\times" },
  { label: "=", title: "Равно", kind: "text", value: "=" },
  { label: "a⁄b", title: "Дробь", kind: "fraction" },
  { label: "x²", title: "Квадрат", kind: "square" },
  { label: "xⁿ", title: "Степень", kind: "power" },
  { label: "xₙ", title: "Нижний индекс", kind: "subscript" },
  { label: "√", title: "Квадратный корень", kind: "root" },
  { label: "ⁿ√", title: "Корень n-й степени", kind: "nthRoot" },
  { label: "( )", title: "Скобки", kind: "parentheses" },
];

function compoundExpression(value: string) {
  return /(?:[+=]|(^|[^\\])[-+])/.test(value);
}

function payloadLength(value: string) {
  const visibleApproximation = value
    .replace(/\\placeholder(?:\[[^\]]*\])?\{[^}]*\}/g, "")
    .replace(/\\(?:left|right)\b/g, "")
    .replace(/\\[a-zA-Z]+/g, "x")
    .replace(/[{}\s]/g, "");
  return Array.from(visibleApproximation).length;
}

function cloneSelection(selection: Readonly<Selection>): Selection {
  return { direction: selection.direction, ranges: selection.ranges.map(([start, end]) => [start, end]) };
}

export default function FormulaEditor({ value, onChange, placeholder = "Введите формулу", ariaLabel = "Редактор формулы", disabled = false, readOnly = false, allowPaste = true, maxExpressionLength = 500, className = "" }: FormulaEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mathfieldRef = useRef<MathfieldElementType | null>(null);
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);
  const lastValidValueRef = useRef(value);
  const lastSelectionRef = useRef<Selection | null>(null);
  const messageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ready, setReady] = useState(false);
  const [focused, setFocused] = useState(false);
  const [symbolsOpen, setSymbolsOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const popoverId = useId();
  const locked = disabled || readOnly || !ready;

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { valueRef.current = value; lastValidValueRef.current = value; }, [value]);

  const showStatus = useCallback((message: string) => {
    setStatusMessage(message);
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    messageTimerRef.current = setTimeout(() => { setStatusMessage(""); messageTimerRef.current = null; }, 2600);
  }, []);

  useEffect(() => () => {
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
  }, []);

  useEffect(() => {
    let disposed = false;
    let field: MathfieldElementType | null = null;
    let handleInput: (() => void) | null = null;
    let handleBeforeInput: ((event: InputEvent) => void) | null = null;
    let handlePaste: ((event: ClipboardEvent) => void) | null = null;
    let handleDrop: ((event: DragEvent) => void) | null = null;
    let handleKeyDown: ((event: KeyboardEvent) => void) | null = null;
    let handleFocus: (() => void) | null = null;
    let handleBlur: (() => void) | null = null;

    void import("mathlive").then(({ MathfieldElement }) => {
      if (disposed || !hostRef.current) return;
      field = new MathfieldElement();
      mathfieldRef.current = field;
      field.value = valueRef.current;
      field.placeholder = "";
      field.setAttribute("aria-label", ariaLabel);
      field.setAttribute("aria-placeholder", placeholder);
      field.mathVirtualKeyboardPolicy = "manual";
      field.smartFence = true;
      field.removeExtraneousParentheses = false;
      field.readOnly = readOnly || disabled;
      if (disabled) field.setAttribute("disabled", "");
      const blockedPaste = () => showStatus("Вставка отключена — введите формулу самостоятельно");
      const exceedsPasteLimit = (payload: string) => {
        if (!field || !payload) return false;
        const selectedLength = field.selectionIsCollapsed ? 0 : Array.from(field.getValue(field.selection, "plain-text").replace(/\s/g, "")).length;
        const currentLength = Array.from(field.getValue("plain-text").replace(/\s/g, "")).length;
        return payload.length > maxExpressionLength * 24 || currentLength - selectedLength + payloadLength(payload) > maxExpressionLength;
      };
      handleBeforeInput = (event) => {
        if (!field) return;
        lastSelectionRef.current = cloneSelection(field.selection);
        if (!allowPaste && (event.inputType === "insertFromPaste" || event.inputType === "insertFromDrop")) {
          event.preventDefault();
          blockedPaste();
        }
      };
      handlePaste = (event) => {
        const payload = event.clipboardData?.getData("application/x-latex") || event.clipboardData?.getData("text/plain") || event.clipboardData?.getData("text/html") || "";
        if (!allowPaste) {
          event.preventDefault();
          blockedPaste();
        } else if (exceedsPasteLimit(payload)) {
          event.preventDefault();
          showStatus("Формула слишком длинная");
        }
      };
      handleDrop = (event) => {
        const payload = event.dataTransfer?.getData("application/x-latex") || event.dataTransfer?.getData("text/plain") || event.dataTransfer?.getData("text/html") || "";
        if (!allowPaste) {
          event.preventDefault();
          blockedPaste();
        } else if (exceedsPasteLimit(payload)) {
          event.preventDefault();
          showStatus("Формула слишком длинная");
        }
      };
      handleKeyDown = (event) => {
        if (!allowPaste && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") {
          event.preventDefault();
          blockedPaste();
        }
      };
      handleInput = () => {
        if (!field) return;
        const nextValue = field.value;
        const expressionLength = Array.from(field.getValue("plain-text").replace(/\s/g, "")).length;
        if (expressionLength > maxExpressionLength) {
          field.value = lastValidValueRef.current;
          if (lastSelectionRef.current) field.selection = lastSelectionRef.current;
          showStatus("Формула слишком длинная");
          return;
        }
        lastValidValueRef.current = nextValue;
        onChangeRef.current(nextValue);
      };
      handleFocus = () => setFocused(true);
      handleBlur = () => setFocused(false);
      field.addEventListener("beforeinput", handleBeforeInput);
      field.addEventListener("paste", handlePaste, true);
      field.addEventListener("drop", handleDrop, true);
      field.addEventListener("keydown", handleKeyDown, true);
      field.addEventListener("input", handleInput);
      field.addEventListener("focus", handleFocus);
      field.addEventListener("blur", handleBlur);
      hostRef.current.append(field);
      field.menuItems = [];
      setReady(true);

      if (disposed) {
        field.removeEventListener("beforeinput", handleBeforeInput);
        field.removeEventListener("paste", handlePaste, true);
        field.removeEventListener("drop", handleDrop, true);
        field.removeEventListener("keydown", handleKeyDown, true);
        field.removeEventListener("input", handleInput);
        field.removeEventListener("focus", handleFocus);
        field.removeEventListener("blur", handleBlur);
        field.remove();
      }
    });

    return () => {
      disposed = true;
      setReady(false);
      setFocused(false);
      if (field) {
        if (handleBeforeInput) field.removeEventListener("beforeinput", handleBeforeInput);
        if (handlePaste) field.removeEventListener("paste", handlePaste, true);
        if (handleDrop) field.removeEventListener("drop", handleDrop, true);
        if (handleKeyDown) field.removeEventListener("keydown", handleKeyDown, true);
        if (handleInput) field.removeEventListener("input", handleInput);
        if (handleFocus) field.removeEventListener("focus", handleFocus);
        if (handleBlur) field.removeEventListener("blur", handleBlur);
        field.replaceWith();
        mathfieldRef.current = null;
      }
    };
  }, [allowPaste, ariaLabel, disabled, maxExpressionLength, placeholder, readOnly, showStatus]);

  useEffect(() => {
    const field = mathfieldRef.current;
    if (field && field.value !== value) field.value = value;
  }, [value]);

  useEffect(() => {
    if (!symbolsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSymbolsOpen(false);
      mathfieldRef.current?.focus();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [symbolsOpen]);

  const insert = useCallback((kind: InsertKind, literal?: string) => {
    const field = mathfieldRef.current;
    if (!field || disabled || readOnly) return;
    const selected = field.selectionIsCollapsed ? "" : field.getValue(field.selection, "latex");
    let latex = literal ?? "";
    let selectionMode: "placeholder" | "after" = "after";

    if (kind === "fraction") {
      latex = selected ? `\\frac{${selected}}{\\placeholder{}}` : "\\frac{\\placeholder{}}{\\placeholder{}}";
      selectionMode = "placeholder";
    } else if (kind === "root") {
      latex = selected ? `\\sqrt{${selected}}` : "\\sqrt{\\placeholder{}}";
      selectionMode = selected ? "after" : "placeholder";
    } else if (kind === "nthRoot") {
      latex = selected ? `\\sqrt[\\placeholder{}]{${selected}}` : "\\sqrt[\\placeholder{}]{\\placeholder{}}";
      selectionMode = "placeholder";
    } else if (kind === "square") {
      const base = selected ? (compoundExpression(selected) ? `\\left(${selected}\\right)` : `{${selected}}`) : "";
      latex = `${base}^{2}`;
    } else if (kind === "power") {
      const base = selected ? (compoundExpression(selected) ? `\\left(${selected}\\right)` : `{${selected}}`) : "";
      latex = `${base}^{\\placeholder{}}`;
      selectionMode = "placeholder";
    } else if (kind === "subscript") {
      const base = selected ? (compoundExpression(selected) ? `\\left(${selected}\\right)` : `{${selected}}`) : "";
      latex = `${base}_{\\placeholder{}}`;
      selectionMode = "placeholder";
    } else if (kind === "parentheses") {
      latex = selected ? `\\left(${selected}\\right)` : "\\left(\\placeholder{}\\right)";
      selectionMode = selected ? "after" : "placeholder";
    }

    field.insert(latex, { insertionMode: "replaceSelection", selectionMode, focus: true, feedback: true });
    field.focus();
  }, [disabled, readOnly]);

  const command = useCallback((name: "moveToPreviousChar" | "moveToNextChar" | "deleteBackward") => {
    const field = mathfieldRef.current;
    if (!field || disabled || readOnly) return;
    field.executeCommand(name);
    field.focus();
  }, [disabled, readOnly]);

  const preserveSelection = (event: React.PointerEvent<HTMLButtonElement>) => event.preventDefault();
  const toggleKeyboard = useCallback(() => {
    const field = mathfieldRef.current;
    if (!field || disabled || readOnly) return;
    const keyboard = window.mathVirtualKeyboard;
    if (keyboard.visible) {
      keyboard.hide();
      return;
    }
    const selection = cloneSelection(field.selection);
    setSymbolsOpen(false);
    field.focus();
    field.selection = selection;
    keyboard.layouts = ["alphabetic", "numeric", "symbols", "greek"];
    keyboard.show();
  }, [disabled, readOnly]);
  const focusSurface = useCallback(() => {
    const field = mathfieldRef.current;
    if (!field || disabled || readOnly || field.hasFocus()) return;
    field.focus();
  }, [disabled, readOnly]);

  return (
    <div className={`${styles.editor} ${className}`.trim()} data-disabled={disabled || undefined} data-readonly={readOnly || undefined}>
      <div className={styles.surface} onPointerDown={focusSurface}>
        <div ref={hostRef} className={styles.mathfieldHost} aria-busy={!ready} />
        {!ready && <span className={styles.loading}>Подготавливаем редактор…</span>}
        {ready && !value && !focused && <span className={styles.placeholderText}>{placeholder}</span>}
      </div>
      <p className={styles.status} role="status" aria-live="polite">{statusMessage}</p>
      <div className={styles.toolbar} role="toolbar" aria-label="Инструменты формулы">
        <div className={styles.toolGroup}>
          {BUTTONS.map((button) => <button key={button.title} type="button" aria-label={button.title} title={button.title} disabled={locked} onPointerDown={preserveSelection} onClick={() => insert(button.kind, button.value)}>{button.label}</button>)}
        </div>
        <div className={styles.secondaryGroup}>
          <div className={styles.symbolsWrap}>
            <button className={styles.symbolsTrigger} type="button" aria-label="Открыть символы" title="Символы" aria-expanded={symbolsOpen} aria-controls={popoverId} disabled={locked} onPointerDown={preserveSelection} onClick={() => setSymbolsOpen((open) => !open)}>Символы <span aria-hidden="true">⌄</span></button>
            {symbolsOpen && <div className={styles.symbols} id={popoverId} role="dialog" aria-label="Физические символы" onKeyDown={(event) => { if (event.key === "Escape") { setSymbolsOpen(false); mathfieldRef.current?.focus(); } }}>
              {SYMBOLS.map(([glyph, latex]) => <button key={glyph} type="button" aria-label={`Вставить ${glyph}`} title={`Вставить ${glyph}`} onPointerDown={preserveSelection} onClick={() => { insert("text", latex); setSymbolsOpen(false); }}>{glyph}</button>)}
            </div>}
          </div>
          <button className={styles.keyboardTrigger} type="button" aria-label="Открыть или закрыть буквенно-цифровую клавиатуру" title="Открыть или закрыть клавиатуру" disabled={locked} onPointerDown={preserveSelection} onClick={toggleKeyboard}>ABC</button>
          <div className={`${styles.toolGroup} ${styles.navigation}`}>
            <button type="button" aria-label="Курсор влево" title="Курсор влево" disabled={locked} onPointerDown={preserveSelection} onClick={() => command("moveToPreviousChar")}>←</button>
            <button type="button" aria-label="Курсор вправо" title="Курсор вправо" disabled={locked} onPointerDown={preserveSelection} onClick={() => command("moveToNextChar")}>→</button>
            <button type="button" aria-label="Удалить слева" title="Удалить слева" disabled={locked} onPointerDown={preserveSelection} onClick={() => command("deleteBackward")}>⌫</button>
          </div>
        </div>
      </div>
    </div>
  );
}
