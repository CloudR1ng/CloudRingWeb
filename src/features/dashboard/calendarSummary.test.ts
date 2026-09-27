import { describe,expect,it } from 'vitest'
import { calendarItemState,calendarPeriodBounds,filterCalendarItems,periodDeadlines,type CalendarSummaryItem } from './calendarSummary'

describe('calendarPeriodBounds',()=>{
  it('returns an inclusive day and Monday-to-Sunday week',()=>{
    expect(calendarPeriodBounds('day','2024-02-29')).toEqual({start:'2024-02-29',end:'2024-02-29'})
    expect(calendarPeriodBounds('week','2024-03-03')).toEqual({start:'2024-02-26',end:'2024-03-03'})
  })
  it('handles leap-month, quarter, half-year and year boundaries',()=>{
    expect(calendarPeriodBounds('month','2024-02-29')).toEqual({start:'2024-02-01',end:'2024-02-29'})
    expect(calendarPeriodBounds('quarter','2024-03-31')).toEqual({start:'2024-01-01',end:'2024-03-31'})
    expect(calendarPeriodBounds('quarter','2024-12-01')).toEqual({start:'2024-10-01',end:'2024-12-31'})
    expect(calendarPeriodBounds('half','2024-06-30')).toEqual({start:'2024-01-01',end:'2024-06-30'})
    expect(calendarPeriodBounds('half','2024-07-01')).toEqual({start:'2024-07-01',end:'2024-12-31'})
    expect(calendarPeriodBounds('year','2024-02-29')).toEqual({start:'2024-01-01',end:'2024-12-31'})
  })
})

const items:CalendarSummaryItem[]=[
  {id:'g1',kind:'goal',title:'VR 목표',deadline:'2024-02-29',status:'in_progress'},
  {id:'t1',kind:'task',title:'보고서',category:'학업',deadline:'2024-02-01',status:'completed'},
  {id:'t2',kind:'task',title:'취소 작업',category:'학업',deadline:'2024-02-15',status:'cancelled'},
  {id:'p1',kind:'project',title:'보관 프로젝트',category:'개인',deadline:'2024-02-20',status:'archived'},
  {id:'e1',kind:'event',title:'발표 준비',category:'학업',deadline:'2024-03-01',status:'todo'},
]

describe('calendar filtering and deadline summary',()=>{
  it('filters inclusive period bounds, excludes cancelled and archived, keeps completed and uncategorized goals in 전체',()=>{
    expect(periodDeadlines(items,'month','2024-02-10').map(item=>item.id)).toEqual(['t1','g1'])
    expect(periodDeadlines(items,'month','2024-02-10','VR 목표').map(item=>item.id)).toEqual(['g1'])
    expect(periodDeadlines(items,'month','2024-02-10','','학업').map(item=>item.id)).toEqual(['t1'])
    expect(periodDeadlines(items,'month','2024-02-10','','개인')).toEqual([])
    expect(periodDeadlines(items,'month','2024-02-10').some(item=>item.id==='e1')).toBe(false)
  })
  it('matches text against title, category, and kind',()=>{
    expect(filterCalendarItems(items,'학업').map(item=>item.id)).toEqual(['t1','t2','e1'])
    expect(filterCalendarItems(items,'goal').map(item=>item.id)).toEqual(['g1'])
  })
})

describe('calendarItemState',()=>{
  it('prioritizes completion/cancellation, overdue, today, next seven days, and scheduled',()=>{
    const today='2024-02-29'
    expect(calendarItemState({id:'a',kind:'task',title:'완료',status:'completed',deadline:'2024-02-01'},today)).toBe('completed')
    expect(calendarItemState({id:'b',kind:'task',title:'취소',status:'cancelled'},today)).toBe('cancelled')
    expect(calendarItemState({id:'c',kind:'task',title:'지남',deadline:'2024-02-28'},today)).toBe('overdue')
    expect(calendarItemState({id:'d',kind:'event',title:'오늘',startsOn:'2024-02-28',endsOn:'2024-03-01'},today)).toBe('today')
    expect(calendarItemState({id:'e',kind:'goal',title:'임박',deadline:'2024-03-07'},today)).toBe('upcoming')
    expect(calendarItemState({id:'f',kind:'project',title:'나중',deadline:'2024-03-08'},today)).toBe('scheduled')
    expect(calendarItemState({id:'g',kind:'task',title:'날짜 없음'},today)).toBe('scheduled')
  })
  it('treats a fully progressed goal as completed and chooses the nearest upcoming date',()=>{
    const today='2024-02-29'
    expect(calendarItemState({id:'g',kind:'goal',title:'완료 목표',progress:100},today)).toBe('completed')
    expect(calendarItemState({id:'e',kind:'event',title:'기간',startsOn:'2024-03-10',deadline:'2024-03-02'},today)).toBe('upcoming')
  })
})
