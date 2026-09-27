export type SupabaseConfiguration =
  | { status: 'ready'; url: string; key: string }
  | { status: 'missing' | 'invalid'; message: string }

export function isPrivilegedSupabaseKey(key: string): boolean {
  if (key.toLowerCase().startsWith('sb_secret_') || /^service_role\b/i.test(key)) return true
  const parts = key.split('.')
  if (parts.length !== 3) return false
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))) as { role?: unknown }
    return typeof payload.role === 'string' && payload.role.toLowerCase() === 'service_role'
  } catch {
    return false
  }
}

export function findPrivilegedBrowserEnvironment(env: Record<string, string | undefined>): string | undefined {
  return Object.entries(env).find(([name, value]) => /(?:SECRET|SERVICE_ROLE)/i.test(name) || isPrivilegedSupabaseKey(value ?? ''))?.[0]
}

function isLegacyAnonKey(key: string): boolean {
  const parts = key.split('.')
  if (parts.length !== 3) return false
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))) as { role?: unknown }
    return payload.role === 'anon'
  } catch {
    return false
  }
}

export function resolveSupabaseConfiguration(urlValue?: string, publishableValue?: string, legacyAnonValue?: string): SupabaseConfiguration {
  const url = urlValue?.trim() ?? ''
  const key = (publishableValue?.trim() || legacyAnonValue?.trim()) ?? ''
  if (!url && !key) return { status: 'missing', message: '개인 공간 연결을 준비하고 있습니다.' }
  if (!url || !key) return { status: 'invalid', message: 'Supabase 연결 설정을 확인할 수 없습니다.' }
  if (isPrivilegedSupabaseKey(key) || (key.startsWith('eyJ') && !isLegacyAnonKey(key))) {
    return { status: 'invalid', message: '브라우저에 사용할 수 없는 키입니다. 서버 관리자에게 설정을 확인해 주세요.' }
  }
  if (!key.startsWith('sb_publishable_') && !isLegacyAnonKey(key)) {
    return { status: 'invalid', message: 'Supabase 공개 키 설정을 확인해 주세요.' }
  }
  try {
    const parsed = new URL(url)
    const loopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]'
    if ((!loopback && parsed.protocol !== 'https:') || (loopback && !['https:', 'http:'].includes(parsed.protocol)) || parsed.username || parsed.password) throw new Error('invalid URL')
  } catch {
    return { status: 'invalid', message: 'Supabase URL 형식을 확인해 주세요.' }
  }
  return { status: 'ready', url, key }
}
