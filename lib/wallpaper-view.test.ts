import { describe, expect, it } from 'vitest';
import { selectLatestWallpaperResults, selectWallpaperCalendar, selectWallpaperProject, wallpaperTasks } from './wallpaper-view';
import type { CalendarEvent } from './calendar';
import type { ResearchProject } from './projects';

const project = (status: string, nextTasks: string[] = []): ResearchProject => ({
  id: status, title: status, status, priority: 'medium', stage: 'writing', updated: '', sourcePath: '', summary: '',
  currentFocus: '', questions: [], nextTasks, blocked: [], relatedPaths: [],
});

const event = (id: string, category: CalendarEvent['category'], start: string): CalendarEvent => ({
  id, title: id, start, end: start, allDay: true, description: '', location: '', calendarId: 'primary', htmlLink: '', status: 'confirmed', category,
});

describe('wallpaper view helpers', () => {
  it('prioritizes writing, then active, then the first project', () => {
    expect(selectWallpaperProject([project('active'), project('paused'), project('writing')])?.status).toBe('writing');
    expect(selectWallpaperProject([project('paused'), project('active')])?.status).toBe('active');
    expect(selectWallpaperProject([project('paused')])?.status).toBe('paused');
    expect(selectWallpaperProject([])).toBeNull();
  });

  it('limits next tasks and today events', () => {
    expect(wallpaperTasks(project('writing', ['one', 'two', 'three']))).toEqual(['one', 'two']);
    const now = new Date('2026-09-08T03:00:00.000Z');
    const view = selectWallpaperCalendar([
      event('today-1', 'Research', '2026-09-08'), event('today-2', 'Meeting', '2026-09-08'), event('today-3', 'Other', '2026-09-08'),
      event('deadline', 'Deadline', '2026-09-10'),
    ], now);
    expect(view.today.map((item) => item.id)).toEqual(['today-1', 'today-2']);
    expect(view.next?.id).toBe('deadline');
  });

  it('selects the latest result without throwing for missing data', () => {
    const result = selectLatestWallpaperResults({
      source: 'github', necessaryLabour: { series: [{ year: 2010, value: 1 }, { year: 2020, value: 2 }] } as never,
      decomposition: { periods: [{ period: '2015-2020', toYear: 2020, totalChange: -3 }] } as never,
      validation: { status: 'pass' } as never,
    });
    expect(result).toEqual({ necessaryLabour: 2, necessaryLabourYear: 2020, totalChange: -3, period: '2015-2020', validationStatus: 'pass' });
    expect(selectLatestWallpaperResults({ source: 'empty', necessaryLabour: null, decomposition: null, validation: null })).toEqual({ necessaryLabour: null, necessaryLabourYear: null, totalChange: null, period: null, validationStatus: null });
  });
});

