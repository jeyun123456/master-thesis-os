import type { RepositoryItem } from './repository';
import type { DashboardBundle } from './results';
import type { CalendarErrorCode, CalendarEvent } from './calendar';
import type { GitHubCommitSummary } from './github';
import type { ResearchStatus } from './research-status';
import type { LibraryPaper } from './library';
import type { ResearchProject } from './projects';
import type { Shortcut } from './shortcuts';

type ApiEnvelope<T> = { configured: boolean; items: T; error?: string };
export type RepositorySource = 'github' | 'local' | 'none';
export type RepositoryApiResponse = { configured: boolean; source?: RepositorySource; items: RepositoryItem[]; error?: string };
export type CalendarApiResponse = { configured:boolean; state:'unconfigured'|'ready'|'empty'|'error'; calendarId:string; timezone:'Asia/Seoul'; range:{days:number;timeMin:string;timeMax:string}; items:CalendarEvent[]; errorCode?:CalendarErrorCode; error?:string };
export type ResearchStatusApiResponse = { configured:boolean; status:ResearchStatus|null; error?:string };
export type PaperIndexApiResponse = { configured:boolean; sourcePath:string; items:LibraryPaper[]; error?:string };
export type ShortcutSource = 'github' | 'local' | 'fallback' | 'error';
export type ShortcutApiResponse = { configured:boolean; source:ShortcutSource; path:string; items:Shortcut[]; sha?:string; writable:boolean; missing?:boolean; error?:string };
export type ShortcutSaveResponse = { configured:boolean; source:'github'|'local'; path:string; items:Shortcut[]; sha:string; writable:boolean; error?:string };

async function request<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}
async function mutate<T>(url: string, method: 'PUT' | 'PATCH', body: unknown): Promise<T> {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data as T;
}
async function calendarRequest():Promise<CalendarApiResponse>{
  let lastError: unknown;
  for(let attempt=0;attempt<2;attempt+=1){
    try{
      const response=await fetch('/api/calendar/events?days=14',{cache:'no-store'});
      const data=await response.json() as CalendarApiResponse;
      if(!data||!Array.isArray(data.items)||!data.state)throw new Error('Calendar API returned an invalid response');
      if(data.state!=='error'||attempt===1)return data;
      lastError=new Error(data.error||'Calendar API returned an error response');
    }catch(error){
      lastError=error;
      if(attempt===1)throw error;
    }
    await new Promise((resolve)=>setTimeout(resolve,500));
  }
  throw lastError instanceof Error?lastError:new Error('Calendar API request failed');
}

export const dashboardApi = {
  tree: () => request<RepositoryApiResponse>('/api/github/tree'),
  calendar: calendarRequest,
  results: (resultsPath?: string) => request<DashboardBundle>(resultsPath ? `/api/results?path=${encodeURIComponent(resultsPath)}` : '/api/results'),
  commits: () => request<ApiEnvelope<GitHubCommitSummary[]>>('/api/github/commits'),
  researchStatus: () => request<ResearchStatusApiResponse>('/api/research/status'),
  projects: () => request<ApiEnvelope<ResearchProject[]>>('/api/research/projects'),
  shortcuts: () => request<ShortcutApiResponse>('/api/shortcuts'),
  saveShortcuts: (items: Shortcut[], sha?: string) => mutate<ShortcutSaveResponse>('/api/shortcuts', 'PUT', { items, ...(sha ? { sha } : {}) }),
  updateProjectStatus: (id: string, status: string, sha?: string) => mutate<{ configured:boolean; source:'github'|'local'; project:ResearchProject; sha:string }>(
    '/api/research/projects/status',
    'PATCH',
    { id, status, ...(sha ? { sha } : {}) },
  ),
  papers: () => request<PaperIndexApiResponse>('/api/library/papers'),
};
