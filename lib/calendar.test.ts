import { afterEach,beforeEach,describe,expect,it } from 'vitest';
import { CalendarIntegrationError,calendarConfigured,calendarRange,classifyCalendarEvent,clearCalendarCacheForTests,getCalendarEvents,normalizeCalendarEvent } from './calendar';
const envKeys=['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_REFRESH_TOKEN','GOOGLE_CALENDAR_ID'] as const;const original=Object.fromEntries(envKeys.map(key=>[key,process.env[key]]));
function configured(){process.env.GOOGLE_CLIENT_ID='client';process.env.GOOGLE_CLIENT_SECRET='secret';process.env.GOOGLE_REFRESH_TOKEN='refresh';process.env.GOOGLE_CALENDAR_ID='primary'}
function responses(calendarBody:unknown,calendarStatus=200){let count=0;return async()=>{count+=1;return count===1?new Response(JSON.stringify({access_token:'token'}),{status:200}):new Response(JSON.stringify(calendarBody),{status:calendarStatus})}}
beforeEach(()=>{clearCalendarCacheForTests();configured()});afterEach(()=>{for(const key of envKeys)original[key]===undefined?delete process.env[key]:process.env[key]=original[key]});
describe('calendar configuration and normalization',()=>{
 it('detects missing server credentials',()=>{delete process.env.GOOGLE_REFRESH_TOKEN;expect(calendarConfigured()).toBe(false)});
 it('normalizes an all-day event',()=>{const item=normalizeCalendarEvent({id:'a',summary:'논문 마감',start:{date:'2026-09-10'},end:{date:'2026-09-11'}},'primary');expect(item).toMatchObject({allDay:true,start:'2026-09-10',category:'Deadline',calendarId:'primary'})});
 it('normalizes a timed event and classifies it',()=>{const item=normalizeCalendarEvent({id:'b',summary:'지도교수 미팅',start:{dateTime:'2026-09-10T14:00:00+09:00'},end:{dateTime:'2026-09-10T15:00:00+09:00'}},'research');expect(item).toMatchObject({allDay:false,category:'Meeting',start:'2026-09-10T14:00:00+09:00'});expect(classifyCalendarEvent('중간발표')).toBe('Presentation')});
 it('uses Seoul midnight and clamps the range',()=>{expect(calendarRange(14,new Date('2026-09-08T01:00:00Z'))).toEqual({days:14,timeMin:'2026-09-07T15:00:00.000Z',timeMax:'2026-09-21T15:00:00.000Z'});expect(calendarRange(999,new Date('2026-09-08T01:00:00Z')).days).toBe(365)});
});
describe('Google Calendar requests',()=>{
 it('returns an empty calendar',async()=>{expect(await getCalendarEvents(14,{fetchImpl:responses({items:[]}) as typeof fetch,bypassCache:true})).toEqual([])});
 it('rejects a malformed response',async()=>{await expect(getCalendarEvents(14,{fetchImpl:responses({events:[]}) as typeof fetch,bypassCache:true})).rejects.toMatchObject({code:'malformed_response'})});
 it('distinguishes auth and quota errors',async()=>{await expect(getCalendarEvents(14,{fetchImpl:responses({error:'invalid_grant'},401) as typeof fetch,bypassCache:true})).rejects.toMatchObject({code:'auth_error'});await expect(getCalendarEvents(14,{fetchImpl:responses({error:{errors:[{reason:'quotaExceeded'}]}},403) as typeof fetch,bypassCache:true})).rejects.toMatchObject({code:'quota_error'})});
 it('distinguishes network errors',async()=>{const fetchImpl=async()=>{throw new Error('offline')};await expect(getCalendarEvents(14,{fetchImpl:fetchImpl as typeof fetch,bypassCache:true})).rejects.toEqual(new CalendarIntegrationError('network_error','Google OAuth token request could not be reached.'))});
});
