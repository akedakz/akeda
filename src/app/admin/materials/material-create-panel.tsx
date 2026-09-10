"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { PageContent, PageHeader, PageShell } from "@/components/page-layout/page-layout";
import { createClient } from "@/lib/supabase/client";
import { beginMaterialFileUpload, createMaterial, createMaterialFolder, finalizeMaterialFileUpload, type ActionResult, type MaterialType } from "./actions";
import styles from "./materials.module.css";

type OpenForm = "folder" | "material" | null;
const typeLabels: Record<MaterialType,string> = { FILE:"Файл",LINK:"Ссылка",VIDEO:"Видео",TEXT:"Текст" };
function readableSize(size:number){return size>=1024**2?`${(size/1024**2).toFixed(1)} МБ`:size>=1024?`${Math.round(size/1024)} КБ`:`${size} Б`;}

function FolderForm({folderId,onCancel,onSuccess}:{folderId:string|null;onCancel:()=>void;onSuccess:(result:ActionResult)=>void}){
  const [name,setName]=useState(""),[error,setError]=useState(""),[pending,startTransition]=useTransition();
  const inputRef=useRef<HTMLInputElement>(null); useEffect(()=>{inputRef.current?.focus();},[]);
  const submit=(event:FormEvent)=>{event.preventDefault();setError("");startTransition(async()=>{const result=await createMaterialFolder(name,folderId);if(result.ok)onSuccess(result);else setError(result.message);});};
  return <form className={styles.form} onSubmit={submit}><label className={styles.field}>Название папки<input ref={inputRef} value={name} onChange={e=>setName(e.target.value)} disabled={pending}/></label><div className={styles.formActions}><button className={styles.primaryButton} disabled={pending}>{pending?"Создаём…":"Создать папку"}</button><button className={styles.secondaryButton} type="button" disabled={pending} onClick={onCancel}>Отмена</button></div>{error&&<p className={styles.formError} role="alert">{error}</p>}</form>;
}

function MaterialForm({folderId,onCancel,onSuccess}:{folderId:string|null;onCancel:()=>void;onSuccess:(result:ActionResult)=>void}){
  const [type,setType]=useState<MaterialType|"">(""),[title,setTitle]=useState(""),[description,setDescription]=useState(""),[externalUrl,setExternalUrl]=useState(""),[textContent,setTextContent]=useState(""),[file,setFile]=useState<File|null>(null),[error,setError]=useState(""),[pending,startTransition]=useTransition();
  const submit=(event:FormEvent)=>{event.preventDefault();setError("");startTransition(async()=>{
    if(!type){setError("Выберите тип материала.");return;}
    if(type==="FILE"){
      if(!file){setError("Выберите файл.");return;} if(file.size>100*1024*1024){setError("Файл должен быть не больше 100 МБ.");return;}
      const metadata={folderId,title,description,originalFileName:file.name,mimeType:file.type||"application/octet-stream",fileSize:file.size};
      const prepared=await beginMaterialFileUpload(metadata);if(!prepared.ok){setError(prepared.message);return;}
      const supabase=createClient();const {error:uploadError}=await supabase.storage.from("materials").uploadToSignedUrl(prepared.path,prepared.token,file,{contentType:metadata.mimeType});
      if(uploadError){setError(`Не удалось загрузить файл: ${uploadError.message}`);return;}
      const result=await finalizeMaterialFileUpload(prepared.materialId);if(result.ok)onSuccess(result);else setError(result.message);return;
    }
    const result=await createMaterial({folderId,type,title,description,externalUrl,textContent});if(result.ok)onSuccess(result);else setError(result.message);
  });};
  return <form className={`${styles.form} ${styles.materialForm}`} onSubmit={submit}><label className={`${styles.field} ${styles.fullField}`}>Сначала выберите тип материала<select value={type} onChange={e=>{setType(e.target.value as MaterialType);setError("");}} disabled={pending}><option value="" disabled>Выберите тип</option>{Object.entries(typeLabels).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label>{type&&<><label className={styles.field}>Название<input autoFocus value={title} onChange={e=>setTitle(e.target.value)} disabled={pending}/></label><label className={styles.field}>Описание <span>необязательно</span><input value={description} onChange={e=>setDescription(e.target.value)} disabled={pending}/></label>
    {type==="FILE"&&<label className={`${styles.filePicker} ${styles.fullField}`}><input type="file" onChange={e=>setFile(e.target.files?.[0]??null)} disabled={pending}/><span>{file?file.name:"Выберите файл"}</span><small>{file?readableSize(file.size):"Максимальный размер — 100 МБ"}</small></label>}
    {(type==="LINK"||type==="VIDEO")&&<label className={`${styles.field} ${styles.fullField}`}>{type==="VIDEO"?"URL видео":"URL ссылки"}<input type="url" placeholder="https://…" value={externalUrl} onChange={e=>setExternalUrl(e.target.value)} disabled={pending}/></label>}
    {type==="TEXT"&&<label className={`${styles.field} ${styles.fullField}`}>Текст материала<textarea className={styles.textContent} rows={8} value={textContent} onChange={e=>setTextContent(e.target.value)} disabled={pending}/></label>}</>}
    <div className={`${styles.formActions} ${styles.fullField}`}><button className={styles.primaryButton} disabled={pending||!type}>{pending?type==="FILE"?"Загружаем…":"Добавляем…":"Добавить материал"}</button><button className={styles.secondaryButton} type="button" disabled={pending} onClick={onCancel}>Отмена</button></div>{error&&<p className={`${styles.formError} ${styles.fullField}`} role="alert">{error}</p>}</form>;
}

export default function MaterialCreatePanel({currentFolderId,title,subtitle,breadcrumb,onBack,onCreated,children}:{currentFolderId:string|null;title:string;subtitle:string;breadcrumb:ReactNode;onBack?:()=>void;onCreated?:(result:ActionResult)=>void;children:ReactNode}){
  const [open,setOpen]=useState<OpenForm>(null),[session,setSession]=useState(0),[notice,setNotice]=useState("");
  useEffect(()=>{if(!notice)return;const timeout=window.setTimeout(()=>setNotice(""),5000);return()=>window.clearTimeout(timeout);},[notice]);
  const close=()=>{setOpen(null);setSession(value=>value+1);};const toggle=(kind:Exclude<OpenForm,null>)=>{setNotice("");if(open===kind)close();else setOpen(kind);};const success=(result:ActionResult)=>{if(!result.ok)return;setNotice(result.message);onCreated?.(result);close();};
  return <PageShell><PageHeader title={title} description={subtitle} actions={<><button className={styles.secondaryButton} onClick={()=>toggle("folder")}>{open==="folder"?"Закрыть форму":"Создать папку"}</button><button className={styles.primaryButton} onClick={()=>toggle("material")}>{open==="material"?"Закрыть форму":"Добавить материал"}</button></>}/><PageContent>{onBack&&<button className={styles.backLink} type="button" onClick={onBack}>← Назад</button>}<div className={styles.breadcrumb}>{breadcrumb}</div>{open&&<section className={styles.createPanel}><div className={styles.formIntro}><span>Новый элемент</span><h2>{open==="folder"?"Создать папку":"Добавить материал"}</h2></div>{open==="folder"?<FolderForm key={`folder-${session}`} folderId={currentFolderId} onCancel={close} onSuccess={success}/>:<MaterialForm key={`material-${session}`} folderId={currentFolderId} onCancel={close} onSuccess={success}/>}</section>}{notice&&<p className={styles.notice} role="status">{notice}</p>}{children}</PageContent></PageShell>;
}
