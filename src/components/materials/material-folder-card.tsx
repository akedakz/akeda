"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { LibrarySort } from "@/lib/library-sort";
import { withSort } from "@/lib/library-sort";
import styles from "./material-cards.module.css";

export type MaterialFolderItem = { id: string; name: string; parentId?: string | null; createdAt?: string; childFolderCount: number; materialCount: number };
function plural(value: number, forms: [string,string,string]) { const mod100=value%100,mod10=value%10; return forms[mod100>=11&&mod100<=14?2:mod10===1?0:mod10>=2&&mod10<=4?1:2]; }

export default function MaterialFolderCard({folder,sort,onNavigate,onAction}:{folder:MaterialFolderItem;sort:LibrarySort;onNavigate?:(id:string)=>void;onAction?:(kind:"rename"|"move"|"delete",folder:MaterialFolderItem)=>void}){
  const[open,setOpen]=useState(false);const wrapRef=useRef<HTMLDivElement>(null),triggerRef=useRef<HTMLButtonElement>(null);
  useEffect(()=>{if(!open)return;wrapRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']")?.focus();const outside=(event:PointerEvent)=>{if(!wrapRef.current?.contains(event.target as Node))setOpen(false);};const escape=(event:KeyboardEvent)=>{if(event.key==="Escape"){setOpen(false);triggerRef.current?.focus();}};document.addEventListener("pointerdown",outside);document.addEventListener("keydown",escape);return()=>{document.removeEventListener("pointerdown",outside);document.removeEventListener("keydown",escape);};},[open]);
  const act=(kind:"rename"|"move"|"delete")=>{setOpen(false);onAction?.(kind,folder);};
  return <article className={styles.folderCard}><Link className={styles.folderMain} href={withSort(`/admin/materials/folders/${folder.id}`,sort)} onClick={onNavigate?(event)=>{event.preventDefault();onNavigate(folder.id);}:undefined}><span className={styles.folderIcon} aria-hidden="true"><svg viewBox="0 0 52 42" fill="none"><path d="M3 10.5A5.5 5.5 0 0 1 8.5 5h11l5 5H43.5a5.5 5.5 0 0 1 5.5 5.5v18A5.5 5.5 0 0 1 43.5 39h-35A5.5 5.5 0 0 1 3 33.5v-23Z"/><path d="M3 16h46"/></svg></span><span className={styles.folderCopy}><strong>{folder.name}</strong><small>{folder.childFolderCount} {plural(folder.childFolderCount,["папка","папки","папок"])} · {folder.materialCount} {plural(folder.materialCount,["материал","материала","материалов"])}</small></span></Link><div className={styles.folderMenuWrap} ref={wrapRef}><button ref={triggerRef} className={styles.folderMenuButton} type="button" aria-label={`Действия с папкой ${folder.name}`} aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>⋮</button>{open&&<div className={styles.folderMenu} role="menu"><button role="menuitem" type="button" onClick={()=>act("rename")}>Переименовать</button><button role="menuitem" type="button" onClick={()=>act("move")}>Переместить</button><hr/><button className={styles.dangerMenuItem} role="menuitem" type="button" onClick={()=>act("delete")}>Удалить</button></div>}</div></article>;
}
