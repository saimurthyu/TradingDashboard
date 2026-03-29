// api/prices.js
// Vercel serverless function — runs on the server, API key never exposed
// Twelve Data free tier: 800 API calls/day, real-time futures prices

const TWELVE_KEY = process.env.TWELVE_DATA_API_KEY;

// Twelve Data symbol mapping for futures
const SYMBOLS = {
  OIL:  "CL1!",   // WTI Crude Oil continuous futures
  GOLD: "GC1!",   // Gold continuous futures
  NQ:   "NQ1!",   // Nasdaq 100 E-mini continuous futures
};

export default async function handler(req, res) {
  // CORS headers — allow your frontend to call this
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (!TWELVE_KEY) {
    return res.status(500).json({ error: "TWELVE_DATA_API_KEY not set in environment variables" });
  }

  try {
    // Fetch all 3 symbols in one batch call — saves API quota
    const symbolList = Object.values(SYMBOLS).join(",");
    const url = `https://api.twelvedata.com/quote?symbol=${symbolList}&apikey=${TWELVE_KEY}`;

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Twelve Data responded ${response.status}`);

    const data = await response.json();

    const out = {};
    for (const [asset, sym] of Object.entries(SYMBOLS)) {
      const q = data[sym];
      if (!q || q.status === "error") {
        out[asset] = { live: false, error: q?.message || "no data" };
        continue;
      }
      const price  = parseFloat(q.close);
      const prev   = parseFloat(q.previous_close);
      const change = ((price - prev) / prev) * 100;
      out[asset] = {
        price:     +price.toFixed(2),
        change:    +change.toFixed(2),
        trend:     change >= 0 ? "bullish" : "bearish",
        live:      true,
        fetchedAt: Date.now(),
      };
    }

    // Cache for 60 seconds at CDN level — reduces calls further
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=30");
    return res.status(200).json(out);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
