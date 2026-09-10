"use client";

import { useState } from "react";
import FormulaEditor from "@/components/formula-editor/formula-editor";
import styles from "./formula-editor-preview.module.css";

export default function FormulaEditorPlayground() {
  const [value, setValue] = useState("");
  return <div className={styles.playground}>
    <FormulaEditor value={value} onChange={setValue} allowPaste maxExpressionLength={500} />
    <div className={styles.actions}><button type="button" disabled={!value} onClick={() => setValue("")}>Очистить</button></div>
    <details className={styles.debug}><summary>Внутреннее значение</summary><output>{value || "Пока пусто"}</output><p>Технический preview только для администратора.</p></details>
  </div>;
}
