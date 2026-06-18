export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { api, path, ...params } = req.query;
  
  let url, headers;
  
  if (api === 'stats') {
    const queryString = new URLSearchParams(params).toString();
    url = `https://api.thestatsapi.com/api/${path}${queryString ? '?' + queryString : ''}`;
    headers = {
      'Authorization': `Bearer ${process.env.STATS_API_KEY}`,
      'Accept': 'application/json',
    };
  } else {
    const queryString = new URLSearchParams(params).toString();
    url = `https://v3.football.api-sports.io/${path}${queryString ? '?' + queryString : ''}`;
    headers = {
      'x-apisports-key': process.env.FOOTBALL_API_KEY,
    };
  }

  try {
    const response = await fetch(url, { headers });
    const data = await response.json();
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
