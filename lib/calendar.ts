export const CALENDAR_TIMEZONE = 'Asia/Seoul';
const DEFAULT_DAYS = 14;
const CACHE_TTL_MS = 5 * 60 * 1000;

export type CalendarCategory = 'Meeting' | 'Deadline' | 'Research' | 'Presentation' | 'Other';
export type CalendarErrorCode = 'auth_error' | 'quota_error' | 'network_error' | 'malformed_response';
export type CalendarEvent = { id:string; title:string; start:string; end:string; allDay:boolean; description:string; location:string; calendarId:string; htmlLink:string; status:string; category:CalendarCategory };
type GoogleEvent = { id?:unknown; summary?:unknown; start?:{date?:unknown;dateTime?:unknown}; end?:{date?:unknown;dateTime?:unknown}; description?:unknown; location?:unknown; htmlLink?:unknown; status?:unknown };
type FetchLike = typeof fetch;
type CalendarOptions = { fetchImpl?:FetchLike; now?:Date; bypassCache?:boolean };
type CacheEntry = { expiresAt:number; items:CalendarEvent[] };
const cache = new Map<string, CacheEntry>();

export class CalendarIntegrationError extends Error {
  constructor(public readonly code:CalendarErrorCode, message:string) { super(message); this.name='CalendarIntegrationError'; }
}

function config(){return {clientId:process.env.GOOGLE_CLIENT_ID,clientSecret:process.env.GOOGLE_CLIENT_SECRET,refreshToken:process.env.GOOGLE_REFRESH_TOKEN,calendarId:process.env.GOOGLE_CALENDAR_ID||'primary'}}
export function calendarConfigured(){const value=config();return Boolean(value.clientId&&value.clientSecret&&value.refreshToken)}
export function configuredCalendarId(){return config().calendarId}

export function classifyCalendarEvent(title:string,description=''):CalendarCategory{
 const value=`${title} ${description}`.toLocaleLowerCase();
 if(/deadline|due\b|마감|제출/.test(value))return 'Deadline';
 if(/presentation|발표|세미나|콜로퀴엄/.test(value))return 'Presentation';
 if(/meeting|미팅|회의|면담|지도교수/.test(value))return 'Meeting';
 if(/research|연구|논문|문헌|분석|작성/.test(value))return 'Research';
 return 'Other';
}
function stringValue(value:unknown){return typeof value==='string'?value:''}
export function normalizeCalendarEvent(raw:GoogleEvent,calendarId:string):CalendarEvent{
 if(!raw||typeof raw!=='object')throw new CalendarIntegrationError('malformed_response','Google Calendar returned an invalid event.');
 const id=stringValue(raw.id);const allDay=Boolean(stringValue(raw.start?.date));const start=allDay?stringValue(raw.start?.date):stringValue(raw.start?.dateTime);const end=allDay?stringValue(raw.end?.date):stringValue(raw.end?.dateTime);
 if(!id||!start||!end)throw new CalendarIntegrationError('malformed_response','Google Calendar event is missing id, start, or end.');
 const title=stringValue(raw.summary)||'(untitled)';const description=stringValue(raw.description);
 return {id,title,start,end,allDay,description,location:stringValue(raw.location),calendarId,htmlLink:stringValue(raw.htmlLink),status:stringValue(raw.status)||'confirmed',category:classifyCalendarEvent(title,description)};
}
function seoulDate(now:Date){return new Intl.DateTimeFormat('en-CA',{timeZone:CALENDAR_TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(now)}
export function calendarRange(days=DEFAULT_DAYS,now=new Date()){
 const safeDays=Number.isFinite(days)?Math.min(Math.max(Math.trunc(days),1),365):DEFAULT_DAYS;const start=new Date(`${seoulDate(now)}T00:00:00+09:00`);const end=new Date(start.getTime()+safeDays*86_400_000);
 return {days:safeDays,timeMin:start.toISOString(),timeMax:end.toISOString()};
}
async function responseJson(response:Response){try{return await response.json() as unknown}catch{throw new CalendarIntegrationError('malformed_response','Google returned malformed JSON.')}}
function googleErrorCode(status:number,body:unknown):CalendarErrorCode{if(status===429)return 'quota_error';const serialized=JSON.stringify(body);if(status===403&&/quotaExceeded|rateLimitExceeded|userRateLimitExceeded/.test(serialized))return 'quota_error';if(status===400||status===401||status===403)return 'auth_error';return 'network_error'}
async function accessToken(fetchImpl:FetchLike){
 const value=config();if(!value.clientId||!value.clientSecret||!value.refreshToken)throw new CalendarIntegrationError('auth_error','Google Calendar is not configured.');
 const body=new URLSearchParams({client_id:value.clientId,client_secret:value.clientSecret,refresh_token:value.refreshToken,grant_type:'refresh_token'});let response:Response;
 try{response=await fetchImpl('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body,cache:'no-store'})}catch{throw new CalendarIntegrationError('network_error','Google OAuth token request could not be reached.')}
 const data=await responseJson(response);if(!response.ok)throw new CalendarIntegrationError(googleErrorCode(response.status,data),'Google OAuth token request failed.');
 const token=typeof data==='object'&&data&&'access_token' in data?stringValue(data.access_token):'';if(!token)throw new CalendarIntegrationError('malformed_response','Google OAuth response did not contain an access token.');return token;
}
export async function getCalendarEvents(days=DEFAULT_DAYS,options:CalendarOptions={}){
 const fetchImpl=options.fetchImpl||fetch;const now=options.now||new Date();const value=config();const range=calendarRange(days,now);const cacheKey=`${value.calendarId}:${range.days}:${range.timeMin}`;const cached=cache.get(cacheKey);
 if(!options.bypassCache&&cached&&cached.expiresAt>now.getTime())return cached.items;
 const token=await accessToken(fetchImpl);const params=new URLSearchParams({timeMin:range.timeMin,timeMax:range.timeMax,timeZone:CALENDAR_TIMEZONE,singleEvents:'true',orderBy:'startTime',showDeleted:'false',maxResults:'100'});let response:Response;
 try{response=await fetchImpl(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(value.calendarId)}/events?${params}`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'})}catch{throw new CalendarIntegrationError('network_error','Google Calendar request could not be reached.')}
 const data=await responseJson(response);if(!response.ok)throw new CalendarIntegrationError(googleErrorCode(response.status,data),'Google Calendar request failed.');if(!data||typeof data!=='object'||!('items' in data)||!Array.isArray(data.items))throw new CalendarIntegrationError('malformed_response','Google Calendar response did not contain an event list.');
 const items=data.items.map(item=>normalizeCalendarEvent(item as GoogleEvent,value.calendarId));cache.set(cacheKey,{expiresAt:now.getTime()+CACHE_TTL_MS,items});return items;
}
export function clearCalendarCacheForTests(){cache.clear()}
