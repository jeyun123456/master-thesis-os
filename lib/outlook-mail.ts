const GRAPH_MESSAGES_ENDPOINT = 'https://graph.microsoft.com/v1.0/me/messages';
const OUTLOOK_MAIL_LIMIT = 5;
const OUTLOOK_MAIL_SELECT = ['id', 'subject', 'from', 'receivedDateTime', 'isRead', 'webLink'].join(',');

export type OutlookMail = {
  id: string;
  subject: string;
  senderName: string;
  senderAddress: string;
  receivedDateTime: string;
  isRead: boolean;
  webLink: string;
};

export type OutlookMailErrorCode =
  | 'unauthorized'
  | 'consent_required'
  | 'rate_limited'
  | 'network_error'
  | 'malformed_response'
  | 'graph_error';

export class OutlookMailError extends Error {
  constructor(public readonly code: OutlookMailErrorCode, message: string) {
    super(message);
    this.name = 'OutlookMailError';
  }
}

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function graphErrorCode(value: unknown): string {
  if (!isRecord(value) || !isRecord(value.error)) return '';
  return stringValue(value.error.code);
}

function graphErrorStatus(status: number, value: unknown): OutlookMailErrorCode {
  const code = graphErrorCode(value).toLocaleLowerCase();
  if (status === 401 || /unauthorized|invalid.?token/.test(code)) return 'unauthorized';
  if (status === 403 || /accessdenied|authorization_requestdenied|consent/.test(code)) return 'consent_required';
  if (status === 429) return 'rate_limited';
  return 'graph_error';
}

export function outlookMailErrorMessage(code: OutlookMailErrorCode): string {
  switch (code) {
    case 'unauthorized':
      return 'Microsoft 365 연결이 만료되었어. 다시 연결해줘.';
    case 'consent_required':
      return '학교 Microsoft 365 정책상 이 앱의 접근 승인이 필요할 수 있어.';
    case 'rate_limited':
      return 'Microsoft Graph 요청이 잠시 제한됐어. 잠시 후 다시 시도해줘.';
    case 'network_error':
      return 'Microsoft Graph에 연결하지 못했어. 잠시 후 다시 시도해줘.';
    case 'malformed_response':
      return '학교 메일 응답 형식을 확인할 수 없어.';
    default:
      return '학교 메일을 불러오지 못했어. Microsoft 365 설정과 권한을 확인해줘.';
  }
}

export function normalizeOutlookMail(raw: unknown): OutlookMail {
  if (!isRecord(raw)) {
    throw new OutlookMailError('malformed_response', outlookMailErrorMessage('malformed_response'));
  }

  const id = stringValue(raw.id);
  const receivedDateTime = stringValue(raw.receivedDateTime);
  if (!id || !receivedDateTime || Number.isNaN(Date.parse(receivedDateTime))) {
    throw new OutlookMailError('malformed_response', outlookMailErrorMessage('malformed_response'));
  }

  const emailAddress = isRecord(raw.from) && isRecord(raw.from.emailAddress) ? raw.from.emailAddress : null;
  const senderAddress = stringValue(emailAddress?.address);
  const senderName = stringValue(emailAddress?.name) || '발신자 정보 없음';

  return {
    id,
    subject: stringValue(raw.subject) || '(제목 없음)',
    senderName,
    senderAddress,
    receivedDateTime,
    isRead: raw.isRead === true,
    webLink: stringValue(raw.webLink),
  };
}

export function normalizeOutlookMailResponse(raw: unknown): OutlookMail[] {
  if (!isRecord(raw) || !Array.isArray(raw.value)) {
    throw new OutlookMailError('malformed_response', outlookMailErrorMessage('malformed_response'));
  }

  return raw.value
    .map(normalizeOutlookMail)
    .sort((left, right) => Date.parse(right.receivedDateTime) - Date.parse(left.receivedDateTime));
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    throw new OutlookMailError('malformed_response', outlookMailErrorMessage('malformed_response'));
  }
}

export async function getRecentOutlookMail(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<OutlookMail[]> {
  if (!accessToken.trim()) {
    throw new OutlookMailError('unauthorized', outlookMailErrorMessage('unauthorized'));
  }

  const params = new URLSearchParams({
    '$top': String(OUTLOOK_MAIL_LIMIT),
    '$orderby': 'receivedDateTime desc',
    '$select': OUTLOOK_MAIL_SELECT,
  });
  let response: Response;
  try {
    response = await fetchImpl(`${GRAPH_MESSAGES_ENDPOINT}?${params.toString()}`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      cache: 'no-store',
    });
  } catch {
    throw new OutlookMailError('network_error', outlookMailErrorMessage('network_error'));
  }

  const data = await responseJson(response);
  if (!response.ok) {
    throw new OutlookMailError(graphErrorStatus(response.status, data), outlookMailErrorMessage(graphErrorStatus(response.status, data)));
  }
  return normalizeOutlookMailResponse(data).slice(0, OUTLOOK_MAIL_LIMIT);
}
