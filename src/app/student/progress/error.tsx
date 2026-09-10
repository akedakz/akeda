"use client";
import { useEffect } from "react";
import styles from "./progress-state.module.css";
export default function ProgressError({error,unstable_retry}:{error:Error&{digest?:string};unstable_retry:()=>void}){useEffect(()=>{console.error("Student progress error",error)},[error]);return <section className={styles.error}><h1>Не удалось загрузить прогресс.</h1><button type="button" onClick={unstable_retry}>Попробовать ещё раз</button></section>}
