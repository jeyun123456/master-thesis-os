import type { CalendarCreateInput } from './calendar';
import type { InboxEntry } from './inbox';

export function calendarInputForInboxEntry(entry: InboxEntry): CalendarCreateInput | null {
  const ai = entry.ai;
  if (!ai || ai.category !== 'schedule' || !ai.dueDate || !hasExplicitDate(entry.rawText, ai.dueDate)) return null;
  const time = explicitTimeNearDate(entry.rawText, ai.dueDate);
  return {
    mailId: `inbox:${entry.id}`,
    candidateId: 'schedule-v1',
    title: ai.title || entry.rawText.slice(0, 100),
    start: time ? `${ai.dueDate}T${time}:00+09:00` : ai.dueDate,
    allDay: !time,
    type: 'event',
    source: 'inbox',
    reason: ai.summary,
  };
}

function hasExplicitDate(rawText: string, expected: string): boolean {
  const patterns = [
    /(?<!\d)(\d{4})[-/.]\s*(\d{1,2})[-/.]\s*(\d{1,2})(?!\d)/g,
    /(?<!\d)(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/g,
  ];
  return patterns.some((pattern) => [...rawText.matchAll(pattern)].some((match) => {
    const [, year, month, day] = match;
    const normalized = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    const parts = normalized.split('-').map(Number);
    const parsed = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    return parsed.getUTCFullYear() === parts[0] && parsed.getUTCMonth() === parts[1] - 1
      && parsed.getUTCDate() === parts[2] && normalized === expected;
  }));
}

function explicitTimeNearDate(rawText: string, date: string): string | null {
  const datePatterns = [
    /(?<!\d)(\d{4})[-/.]\s*(\d{1,2})[-/.]\s*(\d{1,2})(?!\d)/g,
    /(?<!\d)(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/g,
  ];
  const dateMatch = datePatterns.flatMap((pattern) => [...rawText.matchAll(pattern)])
    .find((match) => {
      const [, year, month, day] = match;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}` === date;
    });
  if (!dateMatch || dateMatch.index === undefined) return null;
  const dateEnd = dateMatch.index + dateMatch[0].length;
  const context = rawText.slice(Math.max(0, dateMatch.index - 24), Math.min(rawText.length, dateEnd + 60));
  const match = context.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (match) return `${match[1].padStart(2, '0')}:${match[2]}`;
  const korean = context.match(/(오전|오후)\s*(\d{1,2})(?:\s*시\s*(\d{1,2})\s*분?|\s*시)?/);
  if (!korean) return null;
  let hour = Number(korean[2]);
  const minuteMatch = korean[0].match(/시\s*(\d{1,2})/);
  if (hour < 1 || hour > 12) return null;
  if (korean[1] === '오후' && hour < 12) hour += 12;
  if (korean[1] === '오전' && hour === 12) hour = 0;
  const minute = minuteMatch ? Number(minuteMatch[1]) : 0;
  if (minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
