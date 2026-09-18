import type { MailAnalysisItem, MailSyncStatus } from './mail-analysis';
import type { ThunderbirdAnalysisFolderId, ThunderbirdMail } from './thunderbird-mail';

export type MailTaskStatus = 'pending' | 'done' | 'snoozed' | 'dismissed';

export type MailTask = {
  id: string;
  mailId: string;
  folder: ThunderbirdAnalysisFolderId;
  title: string;
  description: string;
  dueAt: string | null;
  status: MailTaskStatus;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  mail: ThunderbirdMail;
};

export type MailPlanning = {
  tasks: MailTask[];
  items: MailAnalysisItem[];
  sync: MailSyncStatus;
};
