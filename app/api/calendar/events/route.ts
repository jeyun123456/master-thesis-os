import { NextRequest, NextResponse } from 'next/server';
import { CALENDAR_TIMEZONE, CalendarIntegrationError, calendarConfigured, calendarRange, configuredCalendarId, getCalendarEvents } from '@/lib/calendar';

export const runtime = 'nodejs';

export async function GET(req:NextRequest){
 const requestedDays=Number(req.nextUrl.searchParams.get('days')||14);const range=calendarRange(requestedDays);const base={configured:calendarConfigured(),calendarId:configuredCalendarId(),timezone:CALENDAR_TIMEZONE,range};
 if(!base.configured)return NextResponse.json({...base,state:'unconfigured',items:[]});
 try{const items=await getCalendarEvents(range.days);return NextResponse.json({...base,state:items.length?'ready':'empty',items})}
 catch(error){const errorCode=error instanceof CalendarIntegrationError?error.code:'network_error';return NextResponse.json({...base,state:'error',errorCode,items:[]},{status:502})}
}
