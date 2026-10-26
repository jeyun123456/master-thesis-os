/** Mail row shape shared by the Gmail and Outlook lists (Thunderbird itself is not connected yet). */
export type ThunderbirdMail = {
  id: string;
  subject: string;
  senderName: string;
  senderAddress: string;
  receivedAt: string;
  isRead: boolean;
  messageId?: string;
};
