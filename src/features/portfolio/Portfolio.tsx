import { ArrowDown, ArrowUpRight, Orbit } from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from 'react'
import { animate } from 'animejs'
import './portfolio.css'

const OrbitScene = lazy(() => import('./OrbitScene'))
const galaxyImageStyle = {
  '--cr-galaxy-image': `url("${import.meta.env.BASE_URL}backgrounds/galaxy-silver-v1.png")`,
  '--cr-dust-image': `url("${import.meta.env.BASE_URL}backgrounds/galaxy-dust-v1.png")`,
  '--cr-nebula-image': `url("${import.meta.env.BASE_URL}backgrounds/galaxy-nebula-v1.png")`,
} as CSSProperties

type AwardEntry = { date: string; kind: string; title?: string; body?: string; tag: string; project?: { description: string; role: string } }
type AwardYear = { year: string; dated: AwardEntry[]; unknown: AwardEntry[] }
const timeline: AwardYear[] = [
  {
    year: '2025', dated: [
      { date: '07.31', kind: '대전광역시 공공데이터 활용 창업경진대회', title: 'GREENI', body: '작물·관개·시비 결정을 돕는 서비스 아이디어와 웹사이트를 구현했습니다.', tag: '우수상 · 5위', project: { description: '농업 데이터 기반 의사결정 서비스를 개발했습니다.', role: '서비스 기획 · 웹 개발' } },
      { date: '10.25', kind: '제3회 화이트해커 CTF 경진대회', body: '로그·패킷 분석과 XOR·Base64 해석, Write-up 작성을 수행했습니다.', tag: '기업 특별상' },
      { date: '12.18', kind: '데이터안심구역 활용 공동 경진대회', body: '교통·지형 데이터를 분석해 DEM 5m와 경사·곡률·교통 조건을 고려한 A* 우회도로를 제안했습니다.', tag: '데이터미래인재특별상' },
    ], unknown: [
      { date: '월 미상', kind: '제12회 전국 ICT융합 공모전', tag: '장려상' },
    ],
  },
  {
    year: '2026', dated: [
      { date: '07.31–08.02', kind: 'SW미래채움 고교 AI·SW 챌린지', title: 'Waterveyor', body: '2026년 7월 31일부터 8월 2일까지 팀장으로 해커톤에 참가했습니다.', tag: '우수상 · 6위', project: { description: '배수로 쓰레기 제거 장치의 Unity 시각화, 웹 인터페이스, MODI+ 제어를 만들고 인식 모델과 하드웨어를 통합했습니다. 종료·오류 시 모터 정지 동작을 구현했습니다.', role: '팀장 · Unity · 웹 · 장치 제어' } },
      { date: '07.31', kind: '대전광역시 공공데이터·AI 활용 창업경진대회', title: '.ZIP', body: '대전 주거 추천 프로젝트의 모델 구조와 웹 화면을 구현했습니다.', tag: '우수상 · 2위', project: { description: '사용자가 지도에서 원하는 영역을 직접 드래그해 선택하는 주거 추천 입력 흐름을 제작했습니다.', role: '모델 구조 · 웹 개발' } },
      { date: '08.27', kind: '학교안전사고 데이터 분석·활용 경진대회', body: '공통 29개 유형과 231개 가중치 조합을 분석해 결과 포스터를 제작했습니다.', tag: '최우수상 · 고등부 1위' },
    ], unknown: [
      { date: '월 미상', kind: '전국 청소년 숲사랑 작품공모전', title: '붉은 비가 그친 곳', tag: '우수상' },
    ],
  },
]

export default function Portfolio() {
  const root = useRef<HTMLElement>(null)
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    const host = root.current
    if (!host) return
    const entries = Array.from(host.querySelectorAll<HTMLElement>('.cr-entry[data-reveal]'))
    const general = Array.from(host.querySelectorAll<HTMLElement>('[data-reveal]:not(.cr-entry)'))
    const active = new Map<HTMLElement, ReturnType<typeof animate>[]>()
    const generalActive = new Map<HTMLElement, ReturnType<typeof animate>>()
    const revealState = (entry: HTMLElement, state: 'waiting' | 'entering' | 'visible') => entry.dataset.revealState = state
    const parts = (entry: HTMLElement) => [
      entry.querySelector<HTMLElement>('.cr-entry-branch'),
      entry.querySelector<HTMLElement>('.cr-entry-node i'),
      ...Array.from(entry.querySelectorAll<HTMLElement>('.cr-entry-part')),
    ].filter((element): element is HTMLElement => Boolean(element))
    const waitPart = (entry: HTMLElement, element: HTMLElement) => {
      element.style.opacity = '0'
      if (element.classList.contains('cr-entry-branch')) element.style.transform = 'scaleX(0)'
      else if (element.matches('.cr-entry-node i')) element.style.transform = 'scale(.55)'
      else element.style.transform = `translateX(${entry.classList.contains('cr-entry-left') ? '-9px' : '9px'})`
    }
    const reset = (entry: HTMLElement) => {
      active.get(entry)?.forEach((animation) => animation.cancel())
      active.delete(entry)
      parts(entry).forEach((element) => {
        element.style.removeProperty('opacity')
        element.style.removeProperty('transform')
      })
      entry.style.removeProperty('opacity')
      entry.style.removeProperty('transform')
    }
    const revealEntry = (entry: HTMLElement) => {
      active.get(entry)?.forEach((animation) => animation.cancel())
      active.delete(entry)
      if (reducedMotion) { reset(entry); revealState(entry, 'visible'); return }
      revealState(entry, 'entering')
      const animations: ReturnType<typeof animate>[] = []
      active.set(entry, animations)
      const branch = entry.querySelector<HTMLElement>('.cr-entry-branch')
      const core = entry.querySelector<HTMLElement>('.cr-entry-node i')
      if (branch) animations.push(animate(branch, { scaleX: [0, 1], opacity: [0, 1], duration: 210, ease: 'outCubic' }))
      if (core) animations.push(animate(core, { opacity: [0, 1], scale: [.55, 1], duration: 260, delay: 140, ease: 'outCubic' }))
      const content = Array.from(entry.querySelectorAll<HTMLElement>('.cr-entry-part'))
      const direction = entry.classList.contains('cr-entry-left') ? -1 : 1
      if (content.length) animations.push(animate(content, {
        opacity: [0, 1], translateX: [direction * 9, 0],
        duration: 420, delay: (_target, index) => 230 + (index ?? 0) * 55, ease: 'outCubic',
        onComplete: () => { if (entry.dataset.revealState === 'entering') revealState(entry, 'visible') },
      }))
      else revealState(entry, 'visible')
    }

    if (reducedMotion) {
      entries.forEach((entry) => { reset(entry); revealState(entry, 'visible') })
      general.forEach((element) => { element.style.removeProperty('opacity'); element.style.removeProperty('transform') })
      return
    }

    entries.forEach((entry) => {
      const rect = entry.getBoundingClientRect()
      const outside = rect.bottom < 0 || rect.top > window.innerHeight
      revealState(entry, outside ? 'waiting' : 'visible')
      if (outside) parts(entry).forEach((element) => waitPart(entry, element))
    })
    general.forEach((element) => {
      const rect = element.getBoundingClientRect()
      if (rect.bottom < 0 || rect.top > window.innerHeight) {
        element.style.opacity = '0'
        element.style.transform = 'translateY(14px)'
      }
    })
    const observer = new IntersectionObserver((items) => {
      items.forEach(({ target, isIntersecting }) => {
        const entry = target as HTMLElement
        if (!isIntersecting) {
          const rect = entry.getBoundingClientRect()
          if (entry.classList.contains('cr-entry') && (rect.bottom <= 0 || rect.top >= window.innerHeight)) {
            if (entry.contains(document.activeElement)) return
            active.get(entry)?.forEach((animation) => animation.cancel())
            active.delete(entry)
            parts(entry).forEach((element) => waitPart(entry, element))
            revealState(entry, 'waiting')
          }
          return
        }
        if (entry.classList.contains('cr-entry')) revealEntry(entry)
        else {
          observer.unobserve(entry)
          generalActive.set(entry, animate(entry, { opacity: [0, 1], translateY: [14, 0], duration: 480, ease: 'outCubic' }))
        }
      })
    }, { threshold: 0, rootMargin: '0px' })
    entries.forEach((entry) => observer.observe(entry))
    general.forEach((element) => observer.observe(element))

    const onFocus = (event: FocusEvent) => {
      const entry = (event.target as HTMLElement | null)?.closest<HTMLElement>('.cr-entry[data-reveal]')
      if (entry) { reset(entry); revealState(entry, 'visible') }
      const reveal = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-reveal]:not(.cr-entry)')
      if (reveal) {
        generalActive.get(reveal)?.cancel()
        generalActive.delete(reveal)
        reveal.style.removeProperty('opacity')
        reveal.style.removeProperty('transform')
      }
    }
    host.addEventListener('focusin', onFocus)
    return () => {
      observer.disconnect()
      host.removeEventListener('focusin', onFocus)
      active.forEach((animations, entry) => { animations.forEach((animation) => animation.cancel()); reset(entry) })
      generalActive.forEach((animation, element) => { animation.cancel(); element.style.removeProperty('opacity'); element.style.removeProperty('transform') })
      generalActive.clear()
      entries.forEach((entry) => { reset(entry); delete entry.dataset.revealState })
      general.forEach((element) => { element.style.removeProperty('opacity'); element.style.removeProperty('transform') })
    }
  }, [reducedMotion])

  return (
    <main className="cr-portfolio" ref={root}>
      <Suspense fallback={<div className="cr-scene cr-scene-fallback" style={galaxyImageStyle} aria-hidden="true"><div className="cr-scene-static"><i className="cr-scene-image cr-scene-image-hero"/><i className="cr-scene-image cr-scene-image-dust"/><i className="cr-scene-image cr-scene-image-nebula"/></div></div>}><OrbitScene /></Suspense>
      <header className="cr-nav">
        <a className="cr-brand" href="#top" aria-label="CloudRing 홈"><span className="cr-brand-icon"><Orbit size={18} /></span>CloudRing<span className="cr-brand-dot">.</span></a>
        <nav aria-label="주요 메뉴"><a href="#awards">수상 기록</a><a href="#contact">연락</a></nav>
      </header>

      <section className="cr-hero" id="top">
        <div className="cr-hero-content">
          <p className="cr-eyebrow"><span /> PERSONAL ARCHIVE <i>—</i> AWARDS &amp; ACHIEVEMENTS</p>
          <h1>작은 궤도,<br /><span>긴 여정.</span></h1>
          <p className="cr-hero-copy">안녕하세요, <strong>김태환</strong>입니다.<br />확인된 대회 수상과 작품에서 맡은 역할을 연도별로 정리했습니다.</p>
          <div className="cr-hero-actions"><a className="cr-button-primary" href="#awards">수상 기록 보기 <ArrowDown size={16} /></a><a className="cr-button-quiet" href="mailto:cloudriing@gmail.com">연락하기 <ArrowUpRight size={15} /></a></div>
        </div>
        <div className="cr-hero-index"><span>01</span><i /> A RECORD IN MOTION</div>
        <div className="cr-scroll-cue"><span>SCROLL TO EXPLORE</span><i /></div>
      </section>

      <section className="cr-intro cr-wrap" data-reveal>
        <p className="cr-section-index">00 / ABOUT THIS SPACE</p>
        <div><h2>움직임과 감각을<br />가상 신체에 잇습니다.</h2><p>운동 의도와 감각을 가상 신체에 연결하는 기술에 관심을 두고 있습니다. 아래에는 확인된 수상 기록과 각 작품에서 맡은 역할을 담았습니다.</p></div>
      </section>

      <section className="cr-journal cr-wrap" id="awards">
        <div className="cr-section-head" data-reveal><div><p className="cr-section-index">01 / AWARDS</p><h2>수상 기록</h2></div><span>확인된 수상 8건</span></div>
        <p className="cr-timeline-note">확인된 수상과 날짜를 연도별로 정리했습니다.</p>
        <div className="cr-timeline">
          {timeline.map((year) => {
            return <section className="cr-timeline-year" key={year.year} aria-label={`${year.year}년 활동`}>
              <h3 className="cr-timeline-year-label"><span>{year.year}</span></h3>
              {year.dated.map((entry, index) => <article className={`cr-entry ${index % 2 ? 'cr-entry-left' : 'cr-entry-right'}`} data-reveal key={`${entry.date}-${entry.kind}`}>
                <div className="cr-entry-node" aria-hidden="true"><span className="cr-entry-branch"/><i /></div>
                  <div className="cr-entry-body"><span className="cr-entry-date cr-entry-part">{entry.date}</span>{entry.title ? <><p className="cr-entry-kind cr-entry-part">{entry.kind}</p><h4 className="cr-entry-award-title cr-entry-part">{entry.title}</h4></> : <h4 className="cr-entry-award-title cr-entry-contest-title cr-entry-part">{entry.kind}</h4>}<span className="cr-entry-tag cr-entry-part">{entry.tag}</span>{entry.body && <p className="cr-entry-part">{entry.body}</p>}{entry.project && <div className="cr-entry-project cr-entry-part"><p>{entry.project.description}</p><span>{entry.project.role}</span></div>}</div>
              </article>)}
              {year.unknown.length > 0 && <><p className="cr-unknown-date-label"><span>월 미상</span></p>{year.unknown.map((entry, index) => {
                const position = year.dated.length + index
                return <article className={`cr-entry ${position % 2 ? 'cr-entry-left' : 'cr-entry-right'}`} data-reveal key={entry.title}>
                  <div className="cr-entry-node" aria-hidden="true"><span className="cr-entry-branch"/><i /></div>
                  <div className="cr-entry-body"><span className="cr-entry-date cr-entry-part">월 미상</span>{entry.title ? <><p className="cr-entry-kind cr-entry-part">{entry.kind}</p><h4 className="cr-entry-award-title cr-entry-part">{entry.title}</h4></> : <h4 className="cr-entry-award-title cr-entry-contest-title cr-entry-part">{entry.kind}</h4>}<span className="cr-entry-tag cr-entry-part">{entry.tag}</span>{entry.body && <p className="cr-entry-part">{entry.body}</p>}</div>
                </article>
              })}</>}
            </section>
          })}
        </div>
      </section>

      <section className="cr-contact cr-wrap" id="contact" data-reveal>
        <p className="cr-section-index">02 / CONTACT</p>
        <div className="cr-contact-content"><h2>함께 이야기 나눠요.</h2><p>프로젝트와 기술에 관한 연락을 기다립니다.</p><a className="cr-contact-pill" href="mailto:cloudriing@gmail.com">cloudriing@gmail.com <ArrowUpRight size={16}/></a></div>
      </section>

      <footer className="cr-footer cr-wrap"><a className="cr-brand" href="#top"><span className="cr-brand-icon"><Orbit size={16} /></span>CloudRing<span className="cr-brand-dot">.</span></a><span>김태환 · 수상 기록</span><a className="cr-footer-contact" href="mailto:cloudriing@gmail.com">cloudriing@gmail.com</a><small>© 2026 CloudRing</small></footer>
    </main>
  )
}

type CertificateProps = {
  src: string
  alt: string
  caption: string
}

/** A privacy-reviewed certificate image; source assets must be masked before use. */
export function Certificate({ src, alt, caption }: CertificateProps) {
  return (
    <figure className="cr-certificate">
      <img src={src} alt={alt} loading="lazy" decoding="async" />
      <figcaption><span>{caption}</span><small>개인정보 일부 가림</small></figcaption>
    </figure>
  )
}
