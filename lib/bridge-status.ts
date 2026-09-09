export const BRIDGE_OFFLINE_MESSAGE = 'Bridge offline: 로컬 브리지가 실행 중인지 확인해줘.';
export const BRIDGE_TIMEOUT_MESSAGE = 'Bridge timeout: 로컬 브리지가 5초 안에 응답하지 않았어.';

export function bridgeResponseMessage(status: number, error: unknown): string {
  const code = typeof error === 'string' ? error : '';
  if (status === 403 && code === 'origin not allowed') return 'Origin blocked: bridge allowed_origins에 Vercel 주소를 추가해줘.';
  if (status === 403 && code === 'invalid token') return 'Invalid token: Settings의 bridge token을 확인해줘.';
  if (status === 404 && code === 'local file not found') return 'Local file not found: 로컬 파일 경로를 확인해줘.';
  return 'Bridge request failed: 로컬 브리지 요청이 거부됐어.';
}
