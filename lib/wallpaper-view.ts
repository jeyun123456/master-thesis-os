import type { CalendarEvent } from './calendar';
import { groupCalendarEvents } from './calendar-view';
import type { ResearchProject } from './projects';
import type { DashboardBundle } from './results';

export const WALLPAPER_REFRESH_MS = 5 * 60 * 1000;

export function selectWallpaperProject(projects: ResearchProject[]): ResearchProject | null {
  return projects.find((project) => project.status === 'writing')
    || projects.find((project) => project.status === 'active')
    || projects[0]
    || null;
}

export function wallpaperTasks(project: ResearchProject | null): string[] {
  return (project?.nextTasks || []).slice(0, 2);
}

export function selectWallpaperCalendar(events: CalendarEvent[], now = new Date()): {
  today: CalendarEvent[];
  next: CalendarEvent | null;
} {
  const grouped = groupCalendarEvents(events, now);
  return { today: grouped.today.slice(0, 2), next: grouped.nextDeadline };
}

export function selectLatestWallpaperResults(bundle: DashboardBundle): {
  necessaryLabour: number | null;
  necessaryLabourYear: number | null;
  totalChange: number | null;
  period: string | null;
  validationStatus: string | null;
} {
  const levels = bundle.necessaryLabour?.series || [];
  const latestLevel = [...levels].sort((a, b) => b.year - a.year)[0];
  const periods = bundle.decomposition?.periods || [];
  const latestPeriod = [...periods].sort((a, b) => b.toYear - a.toYear)[0];
  return {
    necessaryLabour: latestLevel?.value ?? null,
    necessaryLabourYear: latestLevel?.year ?? null,
    totalChange: latestPeriod?.totalChange ?? null,
    period: latestPeriod?.period ?? null,
    validationStatus: bundle.validation?.status ?? null,
  };
}

