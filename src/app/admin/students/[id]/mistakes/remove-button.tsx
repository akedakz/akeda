"use client";
import { useState, useTransition } from "react";
import { removeMistake } from "./actions";
export default function RemoveButton({studentId,mistakeId}:{studentId:string;mistakeId:string}){const[pending,start]=useTransition();const[error,setError]=useState(false);return <><button disabled={pending} onClick={()=>start(async()=>setError(!(await removeMistake(studentId,mistakeId)).ok))}>{pending?"Убираем…":"Убрать"}</button>{error&&<small role="alert">Не удалось убрать задачу.</small>}</>}
