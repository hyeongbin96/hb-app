import { checkBoardKey, readKey, sameSecret, supabase } from './_lib.js';

const ONLINE_MS = 60_000;       // 이 시간 안에 신호를 보낸 사람만 접속 중으로 본다
const KEEP_MS = 24 * 3600_000;  // 하루 지난 기록은 지운다

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const db = supabase();
  if (!db) return res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다.' });

  try {
    // 모든 접속자: "나 여기 있어요" 신호
    if (req.method === 'POST') {
      if (!checkBoardKey(req)) return res.status(401).json({ error: '비밀번호가 필요합니다.' });
      const { id, nickname, cardId } = req.body || {};
      if (typeof id !== 'string' || !/^[a-z0-9]{4,32}$/i.test(id)) return res.status(400).json({ error: 'id가 올바르지 않습니다.' });
      if (typeof nickname !== 'string' || !nickname.trim()) return res.status(400).json({ error: 'nickname이 필요합니다.' });

      const upsert = await fetch(`${db.rest}/presence`, {
        method: 'POST',
        headers: { ...db.headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({
          id,
          nickname: nickname.trim().slice(0, 20),
          card_id: typeof cardId === 'string' ? cardId.slice(0, 32) : null,
          last_seen: new Date().toISOString(),
        }),
      });
      if (!upsert.ok) throw new Error(`Supabase upsert ${upsert.status}: ${await upsert.text()}`);
      return res.status(204).end();
    }

    // 관리자만: 지금 접속 중인 사람 목록
    if (req.method === 'GET') {
      const { ADMIN_PASSWORD } = process.env;
      if (!ADMIN_PASSWORD) return res.status(403).json({ error: 'ADMIN_PASSWORD 환경변수가 없습니다.' });
      if (!sameSecret(readKey(req, 'x-admin-key'), ADMIN_PASSWORD)) return res.status(401).json({ error: '관리자 비밀번호가 틀렸습니다.' });

      const since = new Date(Date.now() - ONLINE_MS).toISOString();
      const list = await fetch(
        `${db.rest}/presence?last_seen=gte.${encodeURIComponent(since)}&select=id,nickname,card_id,last_seen&order=last_seen.desc`,
        { headers: db.headers },
      );
      if (!list.ok) throw new Error(`Supabase GET ${list.status}: ${await list.text()}`);

      const old = new Date(Date.now() - KEEP_MS).toISOString();
      await fetch(`${db.rest}/presence?last_seen=lt.${encodeURIComponent(old)}`, { method: 'DELETE', headers: db.headers })
        .catch((e) => console.warn('오래된 접속 기록 정리 실패', e));

      return res.status(200).json(await list.json());
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: '데이터베이스 요청에 실패했습니다.' });
  }
}
