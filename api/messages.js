const SUPABASE_URL = 'https://cuarcwzthhdzmarjgyax.supabase.co';
const TABLE = 'Fromm_NF';
const PAGE_SIZE = 1000; // Supabase 기본 최대값

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://nf-album-poca.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const key = process.env.SUPABASE_KEY;
  if (!key) return res.status(500).json({ error: 'SUPABASE_KEY not set' });

  const headers = {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
    'Prefer': 'count=exact'
  };

  try {
    // 이모티콘 맵 병렬 조회
    const rEmojiPromise = fetch(`${SUPABASE_URL}/rest/v1/fromm_emoji?select=keyword,image_url`, {
      headers: { ...headers, 'Prefer': '' }
    });

    // 페이지네이션으로 전체 메시지 조회 (1000개씩)
    let allRows = [];
    let offset = 0;

    while (true) {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/${TABLE}?select=*&order=${encodeURIComponent('날짜.asc,순번.asc')}&limit=${PAGE_SIZE}&offset=${offset}`,
        { headers }
      );

      if (!r.ok) {
        const err = await r.text();
        return res.status(r.status).json({ error: err });
      }

      const rows = await r.json();
      allRows = allRows.concat(rows);

      // 가져온 행이 PAGE_SIZE보다 적으면 마지막 페이지
      if (rows.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    // 이모티콘 맵
    const emojiMap = {};
    const rEmoji = await rEmojiPromise;
    if (rEmoji.ok) {
      const emojiRows = await rEmoji.json();
      if (Array.isArray(emojiRows)) {
        emojiRows.forEach(e => {
          if (e.keyword && e.image_url) {
            // DB에 {{키워드}} 형식으로 저장된 경우 중괄호 제거
            const key = e.keyword.replace(/^\{\{|\}\}$/g, '').trim();
            emojiMap[key] = e.image_url;
          }
        });
      }
    }

    function timeToMinutes(t) {
      if (!t) return -1;
      t = t.trim();
      const pm = t.match(/오후\s*(\d{1,2}):(\d{2})/);
      const am = t.match(/오전\s*(\d{1,2}):(\d{2})/);
      const plain = t.match(/^(\d{1,2}):(\d{2})$/);
      if (pm) { let h = parseInt(pm[1]); if (h < 12) h += 12; return h * 60 + parseInt(pm[2]); }
      if (am) { let h = parseInt(am[1]); if (h === 12) h = 0; return h * 60 + parseInt(am[2]); }
      if (plain) return parseInt(plain[1]) * 60 + parseInt(plain[2]);
      return -1;
    }

    function mapMember(sender, member) {
      // 멤버 Select 필드 우선 — 이형 닉네임 정규화
      if (member === '승협' || member === '승협이' || member === '이지곰') return '승협';
      if (member === '동성' || member === '동성이') return '동성';
      if (member) return member; // 그 외 값은 그대로
      // 보낸사람 폴백
      if (sender === '동성이') return '동성';
      if (sender === '승협' || sender === '승협이' || sender === '이지곰') return '승협';
      if (sender) return '승협'; // 닉네임 변경 이후 새 닉네임도 승협으로
      return '';
    }

    const messages = allRows.map((row, idx) => {
      const 날짜raw = (row['날짜'] || '').replace(/\//g, '-');
      const 시간    = row['시간'] || '';
      const 보낸사람 = row['보낸사람'] || '';
      const 멤버raw  = row['멤버'] || '';
      const 미디어_URL = row['미디어_URL'] || '';
      const 순번    = row['순번'] ?? null;

      let datetime = 날짜raw;
      if (날짜raw && 시간 && !날짜raw.includes('T')) {
        const mins = timeToMinutes(시간);
        if (mins >= 0) {
          const h = Math.floor(mins / 60), m = mins % 60;
          datetime = `${날짜raw}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00+09:00`;
        }
      }

      let 종류 = row['종류'] || '';
      if (!종류 && 미디어_URL) {
        const ext = 미디어_URL.split('?')[0].split('.').pop().toLowerCase();
        if (['jpg','jpeg','png','gif','webp'].includes(ext)) 종류 = '사진';
        else if (['mp4','mov','webm'].includes(ext)) 종류 = '영상';
        else if (['mp3','m4a','wav','ogg','aac'].includes(ext)) 종류 = '음성';
      }

      return {
        id: String(row['No'] ?? idx),
        _idx: idx,
        _timeMin: timeToMinutes(시간),
        내용: row['메시지'] || '',
        날짜: datetime,
        날짜raw,
        시간,
        순번,
        멤버: mapMember(보낸사람, 멤버raw),
        보낸사람,
        종류: 종류 || '텍스트',
        미디어_URL,
      };
    }).filter(m => m.날짜raw);

    // 정렬: 1차 날짜, 2차 순번, 3차 시간, 4차 _idx
    messages.sort((a, b) => {
      if (a.날짜raw !== b.날짜raw) return a.날짜raw.localeCompare(b.날짜raw);
      if (a.순번 !== null && b.순번 !== null) return a.순번 - b.순번;
      if (a.순번 !== null) return -1;
      if (b.순번 !== null) return 1;
      if (a._timeMin !== b._timeMin) return a._timeMin - b._timeMin;
      return a._idx - b._idx;
    });

    res.status(200).json({ messages, emojiMap, total: messages.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
