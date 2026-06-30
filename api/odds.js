// /api/odds.js
// Vercel Serverless Function — proxy for The Odds API (the-odds-api.com)
//
// 用途：把你的 ODDS_API_KEY 留在伺服器端，前端儀表板只打這支 endpoint，
// 金鑰永遠不會出現在瀏覽器或對話紀錄裡。
//
// 部署：放進你現有 Vercel 專案的 /api/odds.js
// 環境變數：在 Vercel 後台設定 ODDS_API_KEY（不要寫死在程式碼裡）

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

// 簡單記憶體快取：同一個 serverless instance 內 60 秒內重複請求直接回快取，
// 避免短時間內重複打 API、浪費你的免費額度（100次/小時）。
// 注意：Vercel serverless 是無狀態的，instance 可能隨時被回收，
// 這只是「盡力而為」的省用量機制，不是嚴格快取。
let cache = {};
const CACHE_TTL_MS = 60 * 1000;

export default async function handler(req, res) {
  // CORS：只允許你自己的網域呼叫（部署後請把 '*' 換成你的實際網域）
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

  // 前端可傳入的參數：
  //   sport   - 預設 'soccer_fifa_world_cup'
  //   markets - 預設 'h2h,totals'（1X2 + 大小球）；可加 'spreads'（讓分）
  //   regions - 預設 'eu'（歐洲莊家，賠率格式跟 Stake 一致）
  const sport = req.query.sport || 'soccer_fifa_world_cup';
  const markets = req.query.markets || 'h2h,totals';
  const regions = req.query.regions || 'eu';
  const oddsFormat = req.query.oddsFormat || 'decimal';

  const cacheKey = `${sport}|${markets}|${regions}|${oddsFormat}`;
  const cached = cache[cacheKey];
  if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
    res.setHeader('X-Cache', 'HIT');
    res.status(200).json(cached.data);
    return;
  }

  try {
    const url = `${ODDS_API_BASE}/sports/${encodeURIComponent(sport)}/odds/` +
      `?apiKey=${apiKey}&regions=${regions}&markets=${markets}&oddsFormat=${oddsFormat}`;

    const upstream = await fetch(url);
    const remaining = upstream.headers.get('x-requests-remaining');
    const used = upstream.headers.get('x-requests-used');

    if (!upstream.ok) {
      const errText = await upstream.text();
      res.status(upstream.status).json({
        error: '上游 Odds API 回傳錯誤',
        status: upstream.status,
        detail: errText,
      });
      return;
    }

    const data = await upstream.json();
    cache[cacheKey] = { data, ts: Date.now() };

    res.setHeader('X-Cache', 'MISS');
    if (remaining) res.setHeader('X-RateLimit-Remaining', remaining);
    if (used) res.setHeader('X-RateLimit-Used', used);
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: '請求失敗', detail: String(e) });
  }
}
