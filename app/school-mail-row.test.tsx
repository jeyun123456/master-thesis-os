import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PrioritizedMail } from '@/lib/mail-priority';
import { SchoolMailRow } from './school-mail-panel';

function mail(patch: Partial<PrioritizedMail>): PrioritizedMail {
  return {
    id: 'm1', subject: '奨学金の提出期限について', senderName: '学生課', senderAddress: 'student@example.ac.jp',
    receivedAt: '2026-10-24T01:00:00Z', isRead: false, priority: 'normal', category: 'other', ...patch,
  } as PrioritizedMail;
}

describe('SchoolMailRow', () => {
  it('shows a visible unread marker and no label for normal priority', () => {
    const html = renderToStaticMarkup(<SchoolMailRow item={mail({})} onOpen={() => {}} />);
    expect(html).toContain('microsoft-mail-dot unread');
    expect(html).toContain('aria-label="미읽음"');
    expect(html).not.toContain('school-mail-priority-label');
  });
  it('labels only critical and important mail', () => {
    expect(renderToStaticMarkup(<SchoolMailRow item={mail({ priority: 'critical', isRead: true })} onOpen={() => {}} />)).toContain('긴급');
    expect(renderToStaticMarkup(<SchoolMailRow item={mail({ priority: 'important', isRead: true })} onOpen={() => {}} />)).toContain('중요');
  });
});
