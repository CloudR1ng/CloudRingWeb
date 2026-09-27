import { lazy, Suspense, useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { ArrowLeft, LockKeyhole, LogOut, ShieldCheck } from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import { supabase, supabaseConfiguration } from '../../lib/supabase'
import { resolveLoginEmail } from './loginIdentity'
import { isDuplicateTotpNameError, resolveTotpFactors, type EnrollmentDraft, type TotpFactorRecord } from './mfaFactors'
import './login.css'

const Dashboard = lazy(() => import('../dashboard/Dashboard'))

type Phase = 'loading' | 'signed-out' | 'checking' | 'needs-enrollment' | 'enrolling' | 'challenge' | 'ready' | 'blocked' | 'error'
type GateState = { phase: Phase; session: Session | null; message: string; factorId?: string; qr?: string; secret?: string; pendingFactors?: TotpFactorRecord[] }

async function ownerExists(userId: string): Promise<boolean> {
  if (!supabase) return false
  const { data, error } = await supabase.from('owner_registry').select('owner_id').eq('owner_id', userId).maybeSingle()
  if (error) throw error
  return data?.owner_id === userId
}

export default function AuthPortal({ initialView }: { initialView: 'login' | 'app' }) {
  const [gate, setGate] = useState<GateState>({ phase: supabase ? 'loading' : 'error', session: null, message: supabaseConfiguration.status === 'ready' ? '' : supabaseConfiguration.message })
  const gateRef = useRef(gate)
  gateRef.current = gate
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [working, setWorking] = useState(false)
  const [fatalMessage, setFatalMessage] = useState('')
  const [resetPending, setResetPending] = useState(false)
  const hadSession = useRef(false)
  const inspectionGeneration = useRef(0)
  const operationGeneration = useRef(0)
  const logoutRequested = useRef(false)
  const mounted = useRef(false)
  const mfaSetupInFlight = useRef(false)

  const inspectSession = useCallback(async (session: Session | null, expired = false, preserveReady = false) => {
    if (!supabase) return
    const generation = ++inspectionGeneration.current
    const commit = (state: GateState) => { if (mounted.current && generation === inspectionGeneration.current) setGate(state) }
    if (!session) {
      enrollmentDraftRef.current = undefined
      commit({ phase: 'signed-out', session: null, message: expired ? '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.' : '' })
      hadSession.current = false
      return
    }
    if (enrollmentDraftRef.current && enrollmentDraftRef.current.ownerId !== session.user.id) enrollmentDraftRef.current = undefined
    hadSession.current = true
    if (!(preserveReady && gateRef.current.phase === 'ready' && gateRef.current.session?.user.id === session.user.id)) commit({ phase: 'checking', session, message: '' })
    try {
      const allowed = await ownerExists(session.user.id)
      if (!mounted.current || generation !== inspectionGeneration.current) return
      if (!(await isCurrentSession(session))) return
      if (!allowed) {
        commit({ phase: 'blocked', session: null, message: '이 계정은 개인 공간의 허용된 소유자로 등록되어 있지 않습니다.' })
        await supabase.auth.signOut()
        return
      }
      const [{ data: assurance, error: assuranceError }, { data: factors, error: factorError }] = await Promise.all([
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        supabase.auth.mfa.listFactors(),
      ])
      if (!mounted.current || generation !== inspectionGeneration.current || !(await isCurrentSession(session))) return
      if (assuranceError) throw assuranceError
      if (factorError) throw factorError
      if (assurance.currentLevel === 'aal2') {
        enrollmentDraftRef.current = undefined
        commit({ phase: 'ready', session, message: '' })
        return
      }
      const resolution = resolveTotpFactors(factors.all as TotpFactorRecord[], session.user.id, enrollmentDraftRef.current)
      if (resolution.kind === 'verified') commit({ phase: 'challenge', session, message: '인증 앱의 6자리 코드를 입력해 주세요.', factorId: resolution.factor.id })
      else if (resolution.kind === 'resume') commit({ phase: 'enrolling', session, factorId: resolution.factor.id, qr: resolution.draft?.qr, secret: resolution.draft?.secret, message: resolution.draft?.qr ? '인증 앱에서 QR 코드를 스캔한 뒤 6자리 코드를 입력해 주세요.' : '등록 중인 인증 앱에서 6자리 코드를 입력해 등록을 이어가세요.' })
      else if (resolution.kind === 'choose') commit({ phase: 'needs-enrollment', session, pendingFactors: resolution.factors, message: '등록 중인 인증 앱을 선택해 6자리 코드 입력을 이어가세요.' })
      else commit({ phase: 'needs-enrollment', session, message: '개인 데이터에 접근하려면 TOTP 2단계 인증을 먼저 등록해야 합니다.' })
    } catch (error) {
      if (!mounted.current || generation !== inspectionGeneration.current) return
      commit({ phase: 'error', session, message: `인증 상태를 확인하지 못했습니다: ${error instanceof Error ? error.message : '연결 오류'}` })
    }
  }, [])
  const enrollmentDraftRef = useRef<EnrollmentDraft | undefined>(undefined)

  const isCurrentSession = async (expected: Session): Promise<boolean> => {
    if (!supabase) return false
    const { data, error } = await supabase.auth.getSession()
    if (error) throw error
    return data.session?.access_token === expected.access_token && data.session.user.id === expected.user.id
  }

  const isSameOwnerSession = async (expected: Session): Promise<boolean> => {
    if (!supabase) return false
    const { data, error } = await supabase.auth.getSession()
    if (error) throw error
    return data.session?.user.id === expected.user.id
  }

  useEffect(() => {
    if (!supabase) return
    const authClient=supabase
    let active = true
    mounted.current = true
    const initialGeneration = inspectionGeneration.current
    void authClient.auth.getSession().then(({ data, error }) => {
      if (!active || !mounted.current) return
      if (inspectionGeneration.current !== initialGeneration) return
      if (error) setGate({ phase: 'error', session: null, message: `세션을 읽지 못했습니다: ${error.message}` })
      else void inspectSession(data.session)
    })
    const { data: { subscription } } = authClient.auth.onAuthStateChange((event, session) => {
      window.setTimeout(() => {
        if (!active || !mounted.current) return
        if (event === 'SIGNED_OUT') {
          const expired=hadSession.current
          logoutRequested.current=false; operationGeneration.current+=1; setWorking(false)
          void authClient.auth.getSession().then(({data,error})=>{if(!active||!mounted.current)return;if(error)setGate({phase:'error',session:null,message:`세션 상태를 확인하지 못했습니다: ${error.message}`});else void inspectSession(data.session,expired)})
        }
        else if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'MFA_CHALLENGE_VERIFIED' || event === 'USER_UPDATED') {
          if(logoutRequested.current)return
          if(event==='SIGNED_IN'||event==='MFA_CHALLENGE_VERIFIED'){operationGeneration.current+=1;setWorking(false);setPassword('');if(event==='MFA_CHALLENGE_VERIFIED')setCode('')}
          void inspectSession(session, false, event === 'TOKEN_REFRESHED')
        }
      }, 0)
    })
    return () => { active = false; mounted.current = false; inspectionGeneration.current += 1; subscription.unsubscribe() }
  }, [inspectSession])

  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase) return
    logoutRequested.current=false
    const generation = inspectionGeneration.current
    const operation = ++operationGeneration.current
    setWorking(true); setFatalMessage('')
    try {
      const loginEmail = resolveLoginEmail(email, import.meta.env.VITE_LOGIN_ALIAS, import.meta.env.VITE_LOGIN_EMAIL)
      const { data, error } = await supabase.auth.signInWithPassword({ email: loginEmail, password })
      if (!mounted.current || operation !== operationGeneration.current) return
      if (error) { setFatalMessage('로그인에 실패했습니다. 이메일과 비밀번호, 인증 서비스 설정을 확인해 주세요.'); return }
      setPassword('')
      if (data.session && await isCurrentSession(data.session) && mounted.current && operation === operationGeneration.current && generation === inspectionGeneration.current) await inspectSession(data.session)
    } catch (error) {
      if (mounted.current && operation === operationGeneration.current) setFatalMessage(`로그인 상태를 확인하지 못했습니다: ${error instanceof Error ? error.message : '연결 오류'}`)
    } finally { if (mounted.current && operation === operationGeneration.current) setWorking(false) }
  }

  const beginEnrollment = async () => {
    if (!supabase || !gate.session || mfaSetupInFlight.current) return
    mfaSetupInFlight.current = true
    const session = gate.session
    const generation = inspectionGeneration.current
    const operation = ++operationGeneration.current
    setWorking(true); setFatalMessage('')
    try {
      const { data: factors, error: listError } = await supabase.auth.mfa.listFactors()
      if (listError) throw listError
      if (!mounted.current || generation !== inspectionGeneration.current || operation !== operationGeneration.current || !(await isCurrentSession(session))) return
      const resolution = resolveTotpFactors(factors.all as TotpFactorRecord[], session.user.id, enrollmentDraftRef.current)
      if (resolution.kind === 'verified') { await inspectSession(session); return }
      if (resolution.kind === 'resume') {
        setGate({ phase: 'enrolling', session, factorId: resolution.factor.id, qr: resolution.draft?.qr, secret: resolution.draft?.secret, message: resolution.draft?.qr ? '인증 앱에서 QR 코드를 스캔한 뒤 6자리 코드를 입력해 주세요.' : '등록 중인 인증 앱에서 6자리 코드를 입력해 등록을 이어가세요.' })
        return
      }
      if (resolution.kind === 'choose') { setGate({ phase: 'needs-enrollment', session, pendingFactors: resolution.factors, message: '등록 중인 인증 앱을 선택해 6자리 코드 입력을 이어가세요.' }); return }
      if (!mounted.current || generation !== inspectionGeneration.current || operation !== operationGeneration.current || !(await isCurrentSession(session))) return
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'CloudRing 인증 앱' })
      if (error) {
        if (isDuplicateTotpNameError(error)) {
          const { data: refreshed, error: refreshError } = await supabase.auth.mfa.listFactors()
          if (refreshError) throw refreshError
          if (!mounted.current || generation !== inspectionGeneration.current || operation !== operationGeneration.current || !(await isCurrentSession(session))) return
          const retry = resolveTotpFactors(refreshed.all as TotpFactorRecord[], session.user.id)
          if (retry.kind === 'resume') { setGate({ phase: 'enrolling', session, factorId: retry.factor.id, message: '등록 중인 인증 앱에서 6자리 코드를 입력해 등록을 이어가세요.' }); return }
          if (retry.kind === 'choose') { setGate({ phase: 'needs-enrollment', session, pendingFactors: retry.factors, message: '등록 중인 인증 앱을 선택해 주세요.' }); return }
        }
        throw error
      }
      if (!mounted.current || generation !== inspectionGeneration.current || operation !== operationGeneration.current || !(await isCurrentSession(session))) return
      enrollmentDraftRef.current = { ownerId: session.user.id, factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret }
      setGate({ phase: 'enrolling', session, message: '인증 앱에서 QR 코드를 스캔한 뒤 6자리 코드를 입력해 주세요.', factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret })
    } catch (error) {
      if (!mounted.current || generation !== inspectionGeneration.current || operation !== operationGeneration.current) return
      setFatalMessage(`인증 앱 등록을 시작하지 못했습니다: ${error instanceof Error ? error.message : '연결 오류'}`)
    } finally { mfaSetupInFlight.current = false; if (mounted.current && operation === operationGeneration.current) setWorking(false) }
  }

  const resumePending = (factor: TotpFactorRecord) => {
    if (!gate.session) return
    setFatalMessage(''); setCode(''); setResetPending(false)
    setGate({ phase: 'enrolling', session: gate.session, factorId: factor.id, message: '등록 중인 인증 앱에서 6자리 코드를 입력해 등록을 이어가세요.' })
  }

  const resetPendingAndEnroll = async () => {
    if (!supabase || !gate.session || !gate.factorId || !resetPending || mfaSetupInFlight.current) return
    mfaSetupInFlight.current = true
    const session = gate.session, generation = inspectionGeneration.current, operation = ++operationGeneration.current
    setWorking(true); setFatalMessage('')
    try {
      const { data: latest, error: listError } = await supabase.auth.mfa.listFactors()
      if (listError) throw listError
      const resolution = resolveTotpFactors(latest.all as TotpFactorRecord[], session.user.id)
      if (resolution.kind === 'verified') throw new Error('검증된 인증 앱이 확인되어 초기화를 중단했습니다.')
      const pending = (latest.all as TotpFactorRecord[]).find((item) => item.factor_type === 'totp' && item.status === 'unverified' && item.id === gate.factorId)
      if (!pending) throw new Error('선택한 미완료 등록을 찾지 못했습니다. 인증 상태를 다시 확인해 주세요.')
      if (!mounted.current || generation !== inspectionGeneration.current || operation !== operationGeneration.current || !(await isCurrentSession(session))) return
      const { error: removeError } = await supabase.auth.mfa.unenroll({ factorId: pending.id })
      if (removeError) throw removeError
      if (!mounted.current || generation !== inspectionGeneration.current || operation !== operationGeneration.current || !(await isCurrentSession(session))) return
      enrollmentDraftRef.current = undefined
      setGate({ phase: 'needs-enrollment', session, message: '새 인증 앱 등록을 시작합니다.' })
      mfaSetupInFlight.current = false
      await beginEnrollment()
    } catch (error) {
      if (mounted.current && generation === inspectionGeneration.current && operation === operationGeneration.current) setFatalMessage(`미완료 등록을 초기화하지 못했습니다: ${error instanceof Error ? error.message : '연결 오류'}`)
    } finally { mfaSetupInFlight.current = false; if (mounted.current && operation === operationGeneration.current) setWorking(false) }
  }

  const verifyCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase || !gate.factorId || !gate.session) return
    const generation = inspectionGeneration.current
    const operation = ++operationGeneration.current
    setWorking(true); setFatalMessage('')
    try {
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: gate.factorId })
      if (challengeError) throw challengeError
      const { error: verifyError } = await supabase.auth.mfa.verify({ factorId: gate.factorId, challengeId: challenge.id, code: code.replace(/\s/g, '') })
      if (verifyError) throw verifyError
      if (!mounted.current || generation !== inspectionGeneration.current || operation !== operationGeneration.current || !(await isSameOwnerSession(gate.session))) return
      setCode('')
      const { data: assurance, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (assuranceError) throw assuranceError
      if (assurance.currentLevel !== 'aal2') throw new Error('2단계 인증 완료 상태를 확인하지 못했습니다.')
      const { data: current, error: currentError } = await supabase.auth.getSession()
      if (currentError) throw currentError
      if (!mounted.current || generation !== inspectionGeneration.current || operation !== operationGeneration.current || !current.session || current.session.user.id !== gate.session.user.id) return
      await inspectSession(current.session)
    } catch (error) {
      if (!mounted.current || generation !== inspectionGeneration.current || operation !== operationGeneration.current) return
      setFatalMessage(`코드 확인에 실패했습니다. 인증 앱의 최신 코드를 입력해 주세요. ${error instanceof Error ? error.message : ''}`)
    } finally { if (mounted.current && operation === operationGeneration.current) setWorking(false) }
  }

  const signOut = async () => {
    if (!supabase) return
    inspectionGeneration.current += 1
    const operation = ++operationGeneration.current
    const generation = inspectionGeneration.current
    logoutRequested.current=true
    enrollmentDraftRef.current = undefined
    setResetPending(false)
    setGate({ phase: 'signed-out', session: null, message: '로그아웃 중입니다.' })
    hadSession.current = false
    window.location.hash = '/login'
    setWorking(true)
    try {
      const { error } = await supabase.auth.signOut()
      if (!mounted.current || generation !== inspectionGeneration.current || operation !== operationGeneration.current) return
      if (error) setFatalMessage(`로그아웃에 실패했습니다: ${error.message}`)
      else setGate({ phase: 'signed-out', session: null, message: '로그아웃했습니다.' })
    } catch (error) {
      if (mounted.current && generation === inspectionGeneration.current && operation === operationGeneration.current) setFatalMessage(`로그아웃에 실패했습니다: ${error instanceof Error ? error.message : '연결 오류'}`)
    } finally { if (mounted.current && generation === inspectionGeneration.current && operation === operationGeneration.current) setWorking(false) }
  }

  const retryAuthCheck = async () => {
    if (!supabase) return
    const generation = inspectionGeneration.current
    const operation = ++operationGeneration.current
    setWorking(true); setFatalMessage('')
    try {
      const { data, error } = await supabase.auth.getSession()
      if (error) throw error
      if (!mounted.current || generation !== inspectionGeneration.current || operation !== operationGeneration.current) return
      await inspectSession(data.session)
    } catch (error) {
      if (mounted.current && generation === inspectionGeneration.current && operation === operationGeneration.current) setGate({ phase: 'error', session: null, message: `세션을 다시 확인하지 못했습니다: ${error instanceof Error ? error.message : '연결 오류'}` })
    } finally { if (mounted.current && operation === operationGeneration.current) setWorking(false) }
  }

  const goToApp = () => { window.location.hash = '/app' }
  const qrSource = gate.qr?.startsWith('data:') ? gate.qr : gate.qr ? `data:image/svg+xml;utf8,${encodeURIComponent(gate.qr)}` : undefined

  if (initialView === 'app' && gate.phase === 'ready' && gate.session) return <Suspense fallback={<main className="cr-login"><p className="cr-login-card">개인 공간을 불러오고 있습니다…</p></main>}><Dashboard session={gate.session} onSignOut={() => void signOut()} /></Suspense>

  return (
    <main className="cr-login" style={{'--cr-login-galaxy':`url("${import.meta.env.BASE_URL}backgrounds/galaxy-silver-v1.png")`} as CSSProperties}>
      <a className="cr-login-back" href={import.meta.env.BASE_URL}><ArrowLeft size={16} /> 포트폴리오로</a>
      <section className="cr-login-card" aria-labelledby="cr-auth-title">
        <div className="cr-login-mark"><LockKeyhole size={21} /></div>
        <p className="cr-login-kicker">CLOUDRING / PRIVATE SPACE</p>
        <h1 id="cr-auth-title">{gate.phase === 'ready' ? '개인 공간 연결' : gate.phase === 'challenge' || gate.phase === 'enrolling' ? '2단계 인증' : '개인 공간 로그인'}</h1>

        {supabaseConfiguration.status !== 'ready' && <div className="cr-auth-message" role="status">{supabaseConfiguration.message}<p>로컬 `.env` 파일에 프로젝트 URL과 브라우저 공개 키를 설정하면 인증 화면이 활성화됩니다.</p></div>}
        {gate.message && <div className={`cr-auth-message${gate.phase === 'blocked' || gate.phase === 'error' ? ' is-error' : ''}`} role="status">{gate.message}</div>}
        {fatalMessage && <div className="cr-auth-message is-error" role="alert">{fatalMessage}</div>}

        {supabase && gate.phase === 'signed-out' && <form className="cr-auth-form" onSubmit={signIn}>
          <label>아이디 또는 이메일<input autoComplete="username" type="text" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>비밀번호<input autoComplete="current-password" type="password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <button className="cr-login-demo cr-auth-submit" type="submit" disabled={working}>{working ? '확인 중…' : '로그인'}</button>
          <p className="cr-auth-small">계정 등록은 열려 있지 않습니다. 소유자 계정은 서버 관리자 절차로 등록합니다.</p>
        </form>}

        {supabase && gate.phase === 'loading' && <p className="cr-auth-muted">저장된 인증 상태를 확인하고 있습니다…</p>}
        {supabase && gate.phase === 'checking' && <p className="cr-auth-muted">소유자 권한과 인증 수준을 확인하고 있습니다…</p>}
        {supabase && gate.phase === 'needs-enrollment' && <button type="button" className="cr-login-demo" onClick={() => void beginEnrollment()} disabled={working}>{working ? 'QR 코드 준비 중…' : 'TOTP 인증 앱 등록'}</button>}
        {supabase && gate.phase === 'needs-enrollment' && gate.pendingFactors?.map((factor) => <button key={factor.id} type="button" className="cr-login-demo" onClick={() => resumePending(factor)}>등록 이어가기 · {factor.friendly_name || '인증 앱'}</button>)}

        {supabase && gate.phase === 'enrolling' && <div className="cr-auth-enroll">
          {qrSource && <img className="cr-auth-qr" src={qrSource} alt="인증 앱에서 스캔할 TOTP QR 코드" />}
          {gate.qr ? <p>아이폰 암호 앱에서 CloudRingWeb 항목 → 편집 → 확인 코드 설정 → 설정 키 입력을 선택하세요. QR을 스캔하거나 아래 키를 넣고 생성되는 6자리 코드를 입력하세요.</p> : <p>이미 아이폰에 등록한 CloudRingWeb 확인 코드의 6자리를 입력해 등록을 이어가세요.</p>}
          {gate.secret && <><p>암호 앱의 설정 키 칸에 입력</p><code className="cr-auth-secret">{gate.secret}</code></>}
          <form className="cr-auth-form" onSubmit={verifyCode}><label>인증 앱 코드<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,8}" maxLength={8} required value={code} onChange={(event) => setCode(event.target.value)} /></label><button className="cr-login-demo cr-auth-submit" disabled={working}>{working ? '인증 중…' : '코드 확인 및 등록 완료'}</button></form>
          {!gate.secret && <div className="cr-auth-reset"><button type="button" className="cr-auth-logout" onClick={() => setResetPending((value) => !value)} disabled={working}>설정키를 등록하지 못했나요? 새 QR로 다시 등록</button>{resetPending && <div role="alert"><p>이 미완료 등록을 지우면 기존 설정키로 생성한 코드는 사용할 수 없게 됩니다. 새 QR을 발급할까요?</p><button type="button" className="cr-auth-logout" onClick={() => setResetPending(false)} disabled={working}>취소</button><button type="button" className="cr-login-demo" onClick={() => void resetPendingAndEnroll()} disabled={working}>{working ? '초기화 중…' : '미완료 등록을 지우고 새 QR 발급'}</button></div>}</div>}
        </div>}

        {supabase && gate.phase === 'challenge' && <form className="cr-auth-form" onSubmit={verifyCode}>
          <p>이미 아이폰에 등록한 CloudRingWeb 확인 코드</p>
          <label>인증 앱 코드<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,8}" maxLength={8} required value={code} onChange={(event) => setCode(event.target.value)} /></label>
          <button className="cr-login-demo cr-auth-submit" disabled={working}>{working ? '인증 중…' : '인증하고 계속'}</button>
        </form>}

        {supabase && ['needs-enrollment', 'enrolling', 'challenge', 'error'].includes(gate.phase) && <div className="cr-auth-session-actions">
          <button type="button" className="cr-auth-logout" onClick={() => void retryAuthCheck()} disabled={working}>인증 상태 다시 확인</button>
          <button type="button" className="cr-auth-logout" onClick={() => void signOut()} disabled={working}><LogOut size={15}/> 로그아웃</button>
        </div>}

        {supabase && gate.phase === 'ready' && <div className="cr-auth-ready">
          <p><ShieldCheck size={18} /> 소유자 확인과 2단계 인증 완료</p>
          <span>{gate.session?.user.email}</span>
          <div className="cr-auth-warning">로그인 확인이 완료되었습니다. 개인 공간에서 목표와 일정을 관리하세요.</div>
          {initialView !== 'app' && <button className="cr-login-demo" type="button" onClick={goToApp}>개인 공간 열기</button>}
          <button className="cr-auth-logout" type="button" onClick={() => void signOut()} disabled={working}><LogOut size={15} /> 로그아웃</button>
        </div>}
      </section>
      <a className="cr-auth-demo-link" href="#/demo">가상 데이터 데모 보기</a>
    </main>
  )
}

