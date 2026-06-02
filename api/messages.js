const DB_ID = 'dfa54851e4ed478b9054cd5756f32491';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = process.env.NOTION_TOKEN;
  if (!token) return res.status(500).json({ error: 'NOTION_TOKEN not set' });

  let results = [], cursor = undefined;
  try {
    do {
      const body = {
        sorts: [{ property: '날짜', direction: 'ascending' }],
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {})
      };
      const r = await fetch(`https://api.notion.com/v1/databases/${DB_ID}/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
      if (!r.ok) {
        const err = await r.text();
        return res.status(r.status).json({ error: err });
      }
      const data = await r.json();
      results = results.concat(data.results);
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);

    const rt = (arr) => arr?.map(t => t.plain_text).join('') || '';

    function mapMember(sender, member) {
      if (member) return member;
      if (sender === '이지곰') return '승협';
      if (sender === '동성이') return '동성';
      return '';
    }

    // 시간 텍스트 → 분 단위 숫자 변환 (정렬용)
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

    const messages = results.map((p, idx) => {
      const props = p.properties;
      const 보낸사람  = rt(props['보낸사람']?.rich_text);
      const 시간      = rt(props['시간']?.rich_text);
      const 멤버raw   = props['멤버']?.select?.name || '';
      const 날짜raw   = props['날짜']?.date?.start || '';
      const createdAt = p.created_time || '';

      // 날짜 + 시간 합쳐서 datetime 구성
      let datetime = 날짜raw;
      if (날짜raw && 시간 && !날짜raw.includes('T')) {
        const mins = timeToMinutes(시간);
        if (mins >= 0) {
          const h = Math.floor(mins / 60), m = mins % 60;
          datetime = `${날짜raw}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00+09:00`;
        }
      }

      const 미디어_URL = props['미디어_URL']?.url || '';
      const 종류raw    = props['종류']?.select?.name || '';
      let 종류 = 종류raw;
      if (!종류 && 미디어_URL) {
        const ext = 미디어_URL.split('?')[0].split('.').pop().toLowerCase();
        if (['jpg','jpeg','png','gif','webp'].includes(ext)) 종류 = '사진';
        else if (['mp4','mov','webm'].includes(ext)) 종류 = '영상';
        else if (['mp3','m4a','wav','ogg','aac'].includes(ext)) 종류 = '음성';
      }

      return {
        id: p.id,
        _idx: idx,              // Notion API 반환 순서 보존용
        _timeMin: timeToMinutes(시간), // 시간 정렬용 숫자
        _createdAt: createdAt,
        내용: rt(props['내용']?.title),
        날짜: datetime,
        날짜raw,
        시간,
        멤버: mapMember(보낸사람, 멤버raw),
        보낸사람,
        종류: 종류 || '텍스트',
        미디어_URL,
        메모: rt(props['메모']?.rich_text),
      };
    }).filter(m => m.날짜raw);

    // 정렬: 1차 날짜, 2차 시간(분), 3차 Notion 행 순서(_idx)
    messages.sort((a, b) => {
      if (a.날짜raw !== b.날짜raw) return a.날짜raw.localeCompare(b.날짜raw);
      if (a._timeMin !== b._timeMin) return a._timeMin - b._timeMin;
      return a._idx - b._idx;
    });

    res.status(200).json({ messages, total: messages.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
