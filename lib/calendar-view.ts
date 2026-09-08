import type { CalendarEvent } from './calendar';

const TIMEZONE='Asia/Seoul';
export function seoulDateKey(value:Date|string){return new Intl.DateTimeFormat('en-CA',{timeZone:TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value))}
export function eventDateKey(event:CalendarEvent){return event.allDay?event.start:seoulDateKey(event.start)}
export function groupCalendarEvents(events:CalendarEvent[],now=new Date()){
 const todayKey=seoulDateKey(now);const today=events.filter(event=>eventDateKey(event)===todayKey);const upcoming=events.filter(event=>eventDateKey(event)>todayKey);const nextDeadline=upcoming.find(event=>event.category==='Deadline')||upcoming.find(event=>event.category==='Meeting')||null;
 return {today,upcoming,nextDeadline};
}
export function daysUntil(event:CalendarEvent,now=new Date()){const today=new Date(`${seoulDateKey(now)}T00:00:00+09:00`);const target=new Date(`${eventDateKey(event)}T00:00:00+09:00`);return Math.max(0,Math.round((target.getTime()-today.getTime())/86_400_000))}
