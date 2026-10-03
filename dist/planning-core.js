(function(root){
 const statuses=['Backlog','Todo','In Progress','Review','Done'];
 const colors={Backlog:'gray',Todo:'blue','In Progress':'yellow',Review:'purple',Done:'green'};
 const day=s=>Date.parse(s+'T00:00:00Z')/86400000;
 const iso=n=>new Date(n*86400000).toISOString().slice(0,10);
 const dateValid=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(day(s))&&iso(day(s))===s;
 const progress=tasks=>tasks.length?Math.round(tasks.reduce((sum,t)=>sum+(Number(t.progress)||0),0)/tasks.length):0;
 function validate(task){if(!task.name.trim())return 'Enter a task name.';if(!dateValid(task.startDate)||!dateValid(task.endDate))return 'Enter valid start and end dates.';if(day(task.endDate)<day(task.startDate))return 'The end date must be on or after the start date.';if(day(task.endDate)-day(task.startDate)>366)return 'Keep a task within one year.';if(!statuses.includes(task.status))return 'Choose a valid status.';return '';}
 function bounds(tasks){let today=day(new Date().toISOString().slice(0,10));let start=tasks.length?Math.min(...tasks.map(t=>day(t.startDate))):today;let end=tasks.length?Math.max(...tasks.map(t=>day(t.endDate))):today+13;let lo=start-2,hi=Math.max(lo+13,end+2);return {start:lo,end:hi,days:hi-lo+1}}
 function timelineWindow(range,today){
  const current=day(today),date=new Date(current*86400000),year=date.getUTCFullYear(),month=date.getUTCMonth();let start,end;
  if(range==='Week'){start=current-(date.getUTCDay()+6)%7;end=start+6}
  else {const first=range==='Quarter'?Math.floor(month/3)*3:month,count=range==='Quarter'?3:1;start=Date.UTC(year,first,1)/86400000;end=Date.UTC(year,first+count,1)/86400000-1}
  return {start,end,days:end-start+1};
 }
 const api={dateValid,timelineWindow,statuses,colors,day,iso,progress,validate,bounds};root.Planning=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
