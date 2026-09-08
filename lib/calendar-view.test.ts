import { describe,expect,it } from 'vitest';
import type { CalendarEvent } from './calendar';
import { daysUntil,groupCalendarEvents } from './calendar-view';
const event=(value:Partial<CalendarEvent>):CalendarEvent=>({id:'id',title:'event',start:'2026-09-08T14:00:00+09:00',end:'2026-09-08T15:00:00+09:00',allDay:false,description:'',location:'',calendarId:'primary',htmlLink:'',status:'confirmed',category:'Other',...value});
describe('calendar home groups',()=>{
 it('groups timed and all-day events in Seoul',()=>{const groups=groupCalendarEvents([event({id:'today'}),event({id:'all-day',start:'2026-09-10',end:'2026-09-11',allDay:true})],new Date('2026-09-08T00:00:00Z'));expect(groups.today.map(item=>item.id)).toEqual(['today']);expect(groups.upcoming.map(item=>item.id)).toEqual(['all-day'])});
 it('chooses a deadline before a meeting and computes remaining days',()=>{const meeting=event({id:'meeting',start:'2026-09-09T10:00:00+09:00',category:'Meeting'});const deadline=event({id:'deadline',start:'2026-09-11',end:'2026-09-12',allDay:true,category:'Deadline'});const groups=groupCalendarEvents([meeting,deadline],new Date('2026-09-08T00:00:00Z'));expect(groups.nextDeadline?.id).toBe('deadline');expect(daysUntil(deadline,new Date('2026-09-08T00:00:00Z'))).toBe(3)});
});
