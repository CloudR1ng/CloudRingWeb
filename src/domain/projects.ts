export type ProjectMilestoneInput={dueOn:string|null};
function validDate(value:string):boolean{if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const [year,month,day]=value.split('-').map(Number),date=new Date(Date.UTC(year,month-1,day));return date.getUTCFullYear()===year&&date.getUTCMonth()+1===month&&date.getUTCDate()===day}
export function validateProjectDates(startsOn:string|null|undefined,deadline:string|null|undefined,milestones:ProjectMilestoneInput[]=[]):void{
  if(startsOn&&!validDate(startsOn)||deadline&&!validDate(deadline))throw new Error('프로젝트 날짜를 확인해 주세요.');
  if(startsOn&&deadline&&startsOn>deadline)throw new Error('프로젝트 마감일은 시작일보다 빠를 수 없습니다.');
  if(milestones.some(item=>item.dueOn!==null&&(!validDate(item.dueOn)||startsOn&&item.dueOn<startsOn||deadline&&item.dueOn>deadline)))throw new Error('마일스톤 날짜는 프로젝트 기간 안에 지정해 주세요.');
}
