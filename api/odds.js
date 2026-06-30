// /api/odds.js
// Vercel Serverless Function — proxy for odds-api.io (NOT the-odds-api.com — different service!)
//
// odds-api.io 是「兩段式」API：
//   1. GET /v3/events  → 拿到一批賽事列表（含 id、home、away、date）
//   2. GET /v3/odds?eventId=... → 用上一步的 id 查該場賽事的賠率
//
// 用途：把你的 ODDS_API_KEY 留在伺服器端，前端只打這支 endpoint。
// 環境變數：Vercel 後台設定 ODDS_API_KEY（odds-api.io 發的那把，不是 the-odds-api.com 的）

const ODDS_API_BASE = 'https://api.odds-api.io/v3';

// 簡單記憶體快取，降低重複請求（serverless instance 可能隨時被回收，這只是盡力而為）
let cache = { events: null, eventsTs: 0 };
const EVENTS_TTL_MS = 120 * 1000; // 賽事列表變動慢，快取2分鐘

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: '伺服器未設定 ODDS_API_KEY，請到 Vercel 環境變數設定' });
    return;
  }

  const action = req.query.action || 'events'; // 'events' | 'odds'

  try {
    if (action === 'events') {
      // 抓世界盃相關賽事列表
      const now = Date.now();
      if (cache.events && (now - cache.eventsTs) < EVENTS_TTL_MS) {
        res.setHeader('X-Cache', 'HIT');
        res.status(200).json(cache.events);
        return;
      }

      const sport = req.query.sport || 'football';
      const url = `${ODDS_API_BASE}/events?apiKey=${apiKey}&sport=${encodeURIComponent(sport)}`;
      const upstream = await fetch(url);

      if (!upstream.ok) {
        const errText = await upstream.text();
        res.status(upstream.status).json({
          error: '上游 odds-api.io /events 回傳錯誤',
          status: upstream.status,
          detail: errText,
        });
        return;
      }

      const allEvents = await upstream.json();

      // ★ 重點：odds-api.io 的 /events 不分賽事等級全部回傳（職業聯賽、業餘聯賽、友誼賽都混在一起）。
      // 這裡用 league.slug / league.name 過濾出世界盃，避免前端拿到上千場無關比賽。
      // 同時排除已結束（status:'settled'）的場次，因為已結束的場次不需要顯示賠率。
      const wcEvents = allEvents.filter(function(ev){
        var slug = (ev.league && ev.league.slug || '').toLowerCase();
        var name = (ev.league && ev.league.name || '').toLowerCase();
        var isWorldCup = slug.indexOf('world-cup') > -1 || slug.indexOf('fifa') > -1
          || name.indexOf('world cup') > -1 || name.indexOf('fifa') > -1;
        var notSettled = ev.status !== 'settled';
        return isWorldCup && notSettled;
      });

      const result = {
        count: wcEvents.length,
        totalFetched: allEvents.length,
        note: wcEvents.length === 0
          ? '本批次沒有符合「world-cup/fifa」篩選的場次。可能是 API 還沒收錄世界盃賠率，或這個 sport 參數本身就回傳隨機抽樣（並非全部聯賽），建議改天再試或調整篩選關鍵字。'
          : undefined,
        events: wcEvents,
      };

      cache.events = result;
      cache.eventsTs = now;
      res.setHeader('X-Cache', 'MISS');
      res.status(200).json(result);
      return;
    }

    if (action === 'odds') {
      // 用 eventId 查特定賽事的賠率（前端先呼叫 action=events 找到對應的 id 再帶進來）
      const eventId = req.query.eventId;
      if (!eventId) {
        res.status(400).json({ error: '缺少 eventId 參數' });
        return;
      }
      const bookmakers = req.query.bookmakers || ''; // 例如 'Bet365,Pinnacle'，留空則回傳全部
      var url = `${ODDS_API_BASE}/odds?apiKey=${apiKey}&eventId=${encodeURIComponent(eventId)}`;
      if (bookmakers) url += `&bookmakers=${encodeURIComponent(bookmakers)}`;

      const upstream = await fetch(url);
      if (!upstream.ok) {
        const errText = await upstream.text();
        res.status(upstream.status).json({
          error: '上游 odds-api.io /odds 回傳錯誤',
          status: upstream.status,
          detail: errText,
        });
        return;
      }
      const data = await upstream.json();
      res.status(200).json(data);
      return;
    }

    res.status(400).json({ error: '未知的 action 參數，應為 events 或 odds' });
  } catch (e) {
    res.status(500).json({ error: '請求失敗', detail: String(e) });
  }
}
