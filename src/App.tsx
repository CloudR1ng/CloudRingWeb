import { lazy, Suspense, useEffect, useState } from 'react'

const Dashboard = lazy(() => import('./features/dashboard/Dashboard'))
const Portfolio = lazy(() => import('./features/portfolio/Portfolio'))
const AuthPortal = lazy(() => import('./features/auth/AuthPortal'))

function currentRoute() {
  const value = window.location.hash.replace(/^#\/?/, '')
  return value === 'login' || value === 'app' || value === 'demo' ? value : 'home'
}

export default function App() {
  const [route, setRoute] = useState(currentRoute)

  useEffect(() => {
    const updateRoute = () => setRoute(currentRoute())
    const phrase = 'cloudringlogin'
    let typed = ''
    let resetTimer = 0
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.key.length !== 1) return
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) {
        typed = ''
        return
      }
      typed = (typed + event.key.toLowerCase()).slice(-phrase.length)
      window.clearTimeout(resetTimer)
      resetTimer = window.setTimeout(() => { typed = '' }, 3000)
      if (typed === phrase) {
        typed = ''
        window.clearTimeout(resetTimer)
        window.location.hash = '/login'
      }
    }
    window.addEventListener('hashchange', updateRoute)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('hashchange', updateRoute)
      window.removeEventListener('keydown', onKeyDown)
      window.clearTimeout(resetTimer)
    }
  }, [])

  if (route === 'login' || route === 'app') return <Suspense fallback={<main className="cr-login"><p className="cr-login-card">인증 화면을 여는 중…</p></main>}><AuthPortal initialView={route} /></Suspense>
  if (route === 'demo') return <Suspense fallback={<div className="cr-loading">체험 화면을 여는 중…</div>}><Dashboard /></Suspense>
  return <Suspense fallback={<main className="cr-portfolio"><div className="cr-scene cr-scene-fallback" aria-hidden="true"/><div className="cr-loading">CloudRing 포트폴리오를 여는 중…</div></main>}><Portfolio /></Suspense>
}
