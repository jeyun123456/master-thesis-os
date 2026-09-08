import type { RepositoryItem } from './repository';
import type { DashboardBundle } from './results';
import type { CalendarErrorCode, CalendarEvent } from './calendar';
import type { GitHubCommitSummary } from './github';
import type { ResearchStatus } from './research-status';

type ApiEnvelope<T> = { configured: boolean; items: T; error?: string };
export type CalendarApiResponse = { configured:boolean; state:'unconfigured'|'ready'|'empty'|'error'; calendarId:string; timezone:'Asia/Seoul'; range:{days:number;timeMin:string;timeMax:string}; items:CalendarEvent[]; errorCode?:CalendarErrorCode; error?:string };
export type ResearchStatusApiResponse = { configured:boolean; status:ResearchStatus|null; error?:string };

async function request<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}
async function calendarRequest():Promise<CalendarApiResponse>{const response=await fetch('/api/calendar/events?days=14');const data=await response.json() as CalendarApiResponse;if(!data||!Array.isArray(data.items)||!data.state)throw new Error('Calendar API returned an invalid response');return data}

export const dashboardApi = {
  tree: () => request<ApiEnvelope<RepositoryItem[]>>('/api/github/tree'),
  calendar: calendarRequest,
  results: () => request<DashboardBundle>('/api/results'),
  commits: () => request<ApiEnvelope<GitHubCommitSummary[]>>('/api/github/commits'),
  researchStatus: () => request<ResearchStatusApiResponse>('/api/research/status'),
};
