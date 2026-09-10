"use client";

import katex from "katex";
import { useEffect, useRef } from "react";
import styles from "./math-text.module.css";

type Segment =
  | { kind: "text"; value: string }
  | { kind: "math"; value: string; display: boolean };

function splitMath(source: string): Segment[] {
  const segments: Segment[] = [];
  let textStart = 0;
  let index = 0;

  while (index < source.length) {
    if (source[index] !== "$" || (index > 0 && source[index - 1] === "\\")) {
      index += 1;
      continue;
    }

    const display = source[index + 1] === "$";
    const delimiterLength = display ? 2 : 1;
    const mathStart = index + delimiterLength;
    let end = mathStart;

    while (end < source.length) {
      if (
        source[end] === "$" &&
        (end === 0 || source[end - 1] !== "\\") &&
        (!display || source[end + 1] === "$")
      ) break;
      end += 1;
    }

    if (end >= source.length) {
      index += delimiterLength;
      continue;
    }

    const value = source.slice(mathStart, end);
    if (!value.trim()) {
      index = end + delimiterLength;
      continue;
    }

    if (index > textStart) segments.push({ kind: "text", value: source.slice(textStart, index) });
    segments.push({ kind: "math", value, display });
    index = end + delimiterLength;
    textStart = index;
  }

  if (textStart < source.length) segments.push({ kind: "text", value: source.slice(textStart) });
  return segments.length ? segments : [{ kind: "text", value: source }];
}

function Formula({ value, display }: { value: string; display: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    katex.render(value, ref.current, {
      displayMode: display,
      throwOnError: false,
      strict: "warn",
      trust: false,
      output: "htmlAndMathml",
    });
  }, [display, value]);

  return <span className={display ? styles.display : styles.inline} ref={ref}>{value}</span>;
}

export default function MathText({ children, className }: { children: string; className?: string }) {
  return (
    <span className={[styles.root, className].filter(Boolean).join(" ")}>
      {splitMath(children).map((segment, index) => segment.kind === "text"
        ? <span key={index}>{segment.value}</span>
        : <Formula key={index} value={segment.value} display={segment.display} />)}
    </span>
  );
}
