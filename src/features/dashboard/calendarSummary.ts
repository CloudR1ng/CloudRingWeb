import { addDays, addMonths, startOfWeek, type ViewMode } from '../../domain/dates'

export interface CalendarSummaryItem {
  id:string
  kind:'task'|'event'|'project'|'goal'
  title:string
  category?:string
  startsOn?:string|null
  endsOn?:string|null
  deadline?:string|null
  status?:string
  progress?:number|null
}

export function calendarPeriodBounds(mode:ViewMode,anchor:string):{start:string;end:string}{
  const [year,month]=anchor.split('-').map(Number)
  if(mode==='day')return {start:anchor,end:anchor}
  if(mode==='week'){
    const start=startOfWeek(anchor)
    return {start,end:addDays(start,6)}
  }
  if(mode==='month'){
    const start=`${year}-${String(month).padStart(2,'0')}-01`
    return {start,end:addDays(addMonths(start,1),-1)}
  }
  if(mode==='quarter'){
    const quarterStartMonth=Math.floor((month-1)/3)*3+1
    const start=`${year}-${String(quarterStartMonth).padStart(2,'0')}-01`
    return {start,end:addDays(addMonths(start,3),-1)}
  }
  if(mode==='half'){
    const start=`${year}-${month<=6?'01':'07'}-01`
    return {start,end:addDays(addMonths(start,6),-1)}
  }
  const start=`${year}-01-01`
  return {start,end:`${year}-12-31`}
}

function matchesItem(item:CalendarSummaryItem,query:string,category:string):boolean{
  if(category!=='전체'&&item.category!==category)return false
  const needle=query.trim().toLocaleLowerCase('ko-KR')
  if(!needle)return true
  return [item.title,item.category??'',item.kind].some(value=>value.toLocaleLowerCase('ko-KR').includes(needle))
}

export function filterCalendarItems(items:CalendarSummaryItem[],query:string,category='전체'):CalendarSummaryItem[]{
  return items.filter(item=>matchesItem(item,query,category))
}

export function periodDeadlines(items:CalendarSummaryItem[],mode:ViewMode,anchor:string,query='',category='전체'):CalendarSummaryItem[]{
  const {start,end}=calendarPeriodBounds(mode,anchor)
  return filterCalendarItems(items,query,category)
    .filter(item=>{
      const status=item.status?.toLocaleLowerCase('ko-KR')
      return item.deadline!=null&&item.deadline>=start&&item.deadline<=end&&status!=='cancelled'&&status!=='archived'
    })
    .sort((a,b)=>(a.deadline??'').localeCompare(b.deadline??'')||a.title.localeCompare(b.title,'ko-KR')||a.id.localeCompare(b.id))
}

export function calendarItemState(item:CalendarSummaryItem,today:string):'completed'|'cancelled'|'overdue'|'today'|'upcoming'|'scheduled'{
  const status=item.status?.toLocaleLowerCase('ko-KR')
  if(status==='completed'||(item.kind==='goal'&&item.progress!=null&&item.progress>=100))return 'completed'
  if(status==='cancelled'||status==='archived')return 'cancelled'
  if(item.deadline&&item.deadline<today)return 'overdue'
  if((item.startsOn&&item.startsOn<=today&&(item.endsOn??item.startsOn)>=today)||item.deadline===today)return 'today'
  const nextWeek=addDays(today,7)
  const nextDate=[item.startsOn,item.deadline].filter((date):date is string=>Boolean(date&&date>=today)).sort()[0]
  if(nextDate&&nextDate<=nextWeek)return 'upcoming'
  return 'scheduled'
}
