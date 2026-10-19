import { createHash, timingSafeEqual } from 'node:crypto';

const TABLE = 'boards';
const BOARD_ID = 'main';
const MAX_BYTES = 1_000_000;

function sameSecret(a, b) {
  const hash = (s) => createHash('sha256').update(s).digest();
  return timingSafeEqual(hash(a), hash(b));
}

async function fetchBoard(base, headers) {
  const res = await fetch(`${base}&select=data,version`, { headers });
  if (!res.ok) throw new Error(`Supabase GET ${res.status}: ${await res.text()}`);
  const [row] = await res.json();
  return row || null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BOARD_PASSWORD } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다.' });
  }

  if (BOARD_PASSWORD) {
    let key = '';
    try {
      key = decodeURIComponent(req.headers['x-board-key'] || '');
    } catch {
      key = '';
    }
    if (!sameSecret(key, BOARD_PASSWORD)) return res.status(401).json({ error: '비밀번호가 필요합니다.' });
  }

  const base = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${TABLE}?id=eq.${BOARD_ID}`;
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };

  try {
    if (req.method === 'GET') {
      const row = await fetchBoard(base, headers);
      if (!row) return res.status(500).json({ error: '보드 행이 없습니다. supabase/schema.sql을 실행해 주세요.' });
      return res.status(200).json(row);
    }

    if (req.method === 'PUT') {
      const { data, version } = req.body || {};
      if (!Number.isInteger(version) || version < 0) return res.status(400).json({ error: 'version이 올바르지 않습니다.' });
      if (!data || !Array.isArray(data.columns)) return res.status(400).json({ error: 'data 형식이 올바르지 않습니다.' });
      if (JSON.stringify(data).length > MAX_BYTES) return res.status(413).json({ error: '보드가 너무 큽니다.' });

      // version이 그대로일 때만 저장된다 (그 사이 다른 사람이 저장했으면 0행 → 충돌)
      const update = await fetch(`${base}&version=eq.${version}`, {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify({ data, version: version + 1, updated_at: new Date().toISOString() }),
      });
      if (!update.ok) throw new Error(`Supabase PATCH ${update.status}: ${await update.text()}`);
      const rows = await update.json();
      if (rows.length) return res.status(200).json({ version: rows[0].version });

      return res.status(409).json(await fetchBoard(base, headers));
    }

    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: '데이터베이스 요청에 실패했습니다.' });
  }
}
