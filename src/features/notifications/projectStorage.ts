import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'

const bucket='cloudring-private'
const imageExtensions:Record<string,string>={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}
const projectIdPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function validateProjectImageFile(file:Pick<File,'type'|'size'>):string {
  const extension=imageExtensions[file.type]
  if(!extension)throw new Error('JPEG, PNG, WebP 이미지 파일만 저장할 수 있습니다.')
  if(!Number.isFinite(file.size)||file.size<1||file.size>10*1024*1024)throw new Error('이미지 크기는 10MB 이하여야 합니다.')
  return extension
}

async function verifiedOwner(client:SupabaseClient):Promise<string>{
  const [{data:userData,error:userError},{data:aalData,error:aalError}]=await Promise.all([client.auth.getUser(),client.auth.mfa.getAuthenticatorAssuranceLevel()])
  if(userError||!userData.user)throw new Error('로그인 상태를 확인할 수 없습니다.')
  if(aalError||aalData.currentLevel!=='aal2')throw new Error('TOTP 2단계 인증이 필요합니다.')
  return userData.user.id
}

export async function uploadProjectImage(file:File,projectId:string,client:SupabaseClient|null=supabase):Promise<string>{
  if(!client)throw new Error('Supabase 연결 설정이 없습니다.')
  const extension=validateProjectImageFile(file)
  if(!projectIdPattern.test(projectId))throw new Error('프로젝트 ID 형식이 올바르지 않습니다.')
  const owner=await verifiedOwner(client)
  const path=`${owner}/projects/${projectId}/${crypto.randomUUID()}.${extension}`
  const {error}=await client.storage.from(bucket).upload(path,file,{upsert:false,contentType:file.type,cacheControl:'3600'})
  if(error)throw error
  return path
}

export async function createSignedProjectImageUrl(path:string,client:SupabaseClient|null=supabase):Promise<string>{
  if(!client)throw new Error('Supabase 연결 설정이 없습니다.')
  const owner=await verifiedOwner(client)
  if(!path.startsWith(`${owner}/projects/`)||path.includes('..')||path.includes('\\')||path.startsWith('/'))throw new Error('본인 프로젝트의 저장 경로만 열 수 있습니다.')
  const {data,error}=await client.storage.from(bucket).createSignedUrl(path,60)
  if(error)throw error
  if(!data?.signedUrl)throw new Error('서명된 이미지 주소를 받지 못했습니다.')
  return data.signedUrl
}

export async function removeProjectImage(path:string,client:SupabaseClient|null=supabase):Promise<void>{
  if(!client)throw new Error('Supabase 연결 설정이 없습니다.')
  const owner=await verifiedOwner(client)
  if(!path.startsWith(`${owner}/projects/`)||path.includes('..')||path.includes('\\')||path.startsWith('/'))throw new Error('본인 프로젝트의 저장 경로만 삭제할 수 있습니다.')
  const {data,error}=await client.storage.from(bucket).remove([path])
  if(error)throw error
  if(!data?.some(file=>file.name===path))throw new Error('이미지가 연결 중이거나 삭제 결과를 확인하지 못했습니다. 먼저 프로젝트에서 연결을 해제한 뒤 다시 시도하세요.')
}
