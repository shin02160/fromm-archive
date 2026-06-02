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

    const messages = results.map(p => {
      const props = p.properties;
      const rt = (arr) => arr?.map(t => t.plain_text).join('') || '';
      return {
        id: p.id,
        내용: rt(props['내용']?.title),
        날짜: props['날짜']?.date?.start || '',
        멤버: props['멤버']?.select?.name || '',
        종류: props['종류']?.select?.name || '텍스트',
        미디어_URL: props['미디어_URL']?.url || '',
        메모: rt(props['메모']?.rich_text),
      };
    }).filter(m => m.날짜);

    res.status(200).json({ messages });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
