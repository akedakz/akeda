import Link from "next/link";
import BackLink from "@/components/back-link";
import {notFound}from "next/navigation";
import type{MaterialType}from "../actions";
import{createAdminClient}from "@/lib/supabase/admin";
import MaterialDeleteButton from "@/components/materials/material-delete-button";
import styles from "../materials.module.css";

type Material={id:string;folder_id:string|null;type:MaterialType;title:string;description:string|null;storage_path:string|null;file_size:number|null;external_url:string|null;text_content:string|null;created_at:string};
const labels:Record<MaterialType,string>={FILE:"Файл",LINK:"Ссылка",VIDEO:"Видео",TEXT:"Текст"};
function size(value:number|null){if(value===null)return null;if(value>=1024**2)return`${(value/1024**2).toFixed(1)} МБ`;if(value>=1024)return`${Math.round(value/1024)} КБ`;return`${value} Б`;}
export default async function MaterialPage({params}:{params:Promise<{id:string}>}){
  const{id}=await params,admin=createAdminClient();const{data,error}=await admin.from("materials").select("id, folder_id, type, title, description, storage_path, file_size, external_url, text_content, created_at").eq("id",id).maybeSingle();
  if(error){console.error("Не удалось загрузить материал:",{code:error.code,message:error.message,details:error.details,hint:error.hint});return <div className={styles.queryError}>Не удалось загрузить материал.{process.env.NODE_ENV==="development"&&<code>{error.code||"Supabase error"}: {error.message}</code>}</div>}if(!data)notFound();const material=data as Material;let resourceUrl=material.external_url;
  if(material.type==="FILE"&&material.storage_path){const{data:signed,error:signedError}=await admin.storage.from("materials").createSignedUrl(material.storage_path,15*60);if(signedError)console.error("Не удалось открыть файл материала:",{code:signedError.name,message:signedError.message});else resourceUrl=signed.signedUrl;}
  const back=material.folder_id?`/admin/materials/folders/${material.folder_id}`:"/admin/materials";const action=material.type==="FILE"?"Открыть файл":material.type==="LINK"?"Открыть ссылку":material.type==="VIDEO"?"Смотреть видео":null;
  return <><div className={styles.detailBack}><BackLink href={back}>Назад к материалам</BackLink></div><article className={styles.detail}><span className={styles.eyebrow}>{labels[material.type]}</span><h1>{material.title}</h1>{material.description&&<p className={styles.detailDescription}>{material.description}</p>}<div className={styles.detailMeta}><span>{new Intl.DateTimeFormat("ru-RU",{dateStyle:"long"}).format(new Date(material.created_at))}</span>{size(material.file_size)&&<span>{size(material.file_size)}</span>}</div>{material.type==="TEXT"&&<div className={styles.textBody}>{material.text_content}</div>}<div className={styles.detailActions}>{material.type!=="TEXT"&&(resourceUrl&&action?<Link className={styles.resourceButton} href={resourceUrl} target="_blank" rel="noopener noreferrer">{action}</Link>:<span className={styles.queryError}>Ресурс временно недоступен.</span>)}<MaterialDeleteButton materialId={material.id} title={material.title} redirectAfterDelete/></div></article></>;
}
