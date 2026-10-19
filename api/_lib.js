// api/ 안에서 _로 시작하는 파일은 Vercel 함수로 배포되지 않는다 (공용 코드)
import { createHash, timingSafeEqual } from 'node:crypto';

export function sameSecret(a, b) {
  const hash = (s) => createHash('sha256').update(s).digest();
  return timingSafeEqual(hash(a), hash(b));
}

export function readKey(req, header) {
  try {
    return decodeURIComponent(req.headers[header] || '');
  } catch {
    return '';
  }
}

// BOARD_PASSWORD가 없으면 누구나 통과
export function checkBoardKey(req) {
  const { BOARD_PASSWORD } = process.env;
  return !BOARD_PASSWORD || sameSecret(readKey(req, 'x-board-key'), BOARD_PASSWORD);
}

export function supabase() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return {
    rest: `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1`,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
  };
}
