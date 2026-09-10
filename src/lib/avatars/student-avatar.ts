import"server-only";import{unstable_cache}from"next/cache";import{createAdminClient}from"@/lib/supabase/admin";
const bucket="student-avatars";
async function signStudentAvatar(path:string){const result=await createAdminClient().storage.from(bucket).createSignedUrl(path,3600);if(result.error){console.error("AVATAR_SIGN",{name:result.error.name,message:result.error.message});return null}return result.data.signedUrl}
const createCachedAdminStudentAvatarUrl=unstable_cache(signStudentAvatar,["admin-student-avatar-url"],{revalidate:300});
export async function createStudentAvatarUrl(path:string|null|undefined){return path?signStudentAvatar(path):null}
export async function createAdminStudentAvatarUrl(path:string|null|undefined){return path?createCachedAdminStudentAvatarUrl(path):null}
export async function createStudentAvatarUrls(paths:(string|null|undefined)[]){const unique=[...new Set(paths.filter((path):path is string=>Boolean(path)))];if(!unique.length)return new Map<string,string>();const result=await createAdminClient().storage.from(bucket).createSignedUrls(unique,3600);if(result.error){console.error("AVATAR_BATCH_SIGN",{name:result.error.name,message:result.error.message});return new Map<string,string>()}return new Map(result.data.filter(item=>item.signedUrl).map(item=>[item.path,item.signedUrl!]))}
export const studentAvatarBucket=bucket;
