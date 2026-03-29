import { useState, useEffect, useRef, useCallback } from "react";

// ─── Constants ────────────────────────────────────────────────────────
const GROQ_MODEL  = "llama-3.3-70b-versatile";
const FINNHUB_KEY = "d73p731r01qjjol3r9q0d73p731r01qjjol3r9qg";
const PROXY       = "https://api.allorigins.win/raw?url=";

const ASSETS = [
  { id:"OIL",  label:"WTI CRUDE",  emoji:"🛢",  color:"#f97316", glow:"rgba(249,115,22,0.15)" },
  { id:"GOLD", label:"XAU/USD",    emoji:"🥇",  color:"#eab308", glow:"rgba(234,179,8,0.15)"  },
  { id:"NQ",   label:"NASDAQ 100", emoji:"📡",  color:"#3b82f6", glow:"rgba(59,130,246,0.15)" },
];

const ASSET_KILLZONES = {
  OIL: [
    { name:"LONDON", start:2,   end:5,   color:"#3b82f6", label:"London Open", note:"Primary — energy market opens, big displacement candles" },
    { name:"NY_AM",  start:7,   end:10,  color:"#22c55e", label:"NY AM",       note:"EIA/inventory data window, London continuation" },
    { name:"ASIAN",  start:20,  end:24,  color:"#8b5cf6", label:"Asian",       note:"Low liquidity — avoid unless news catalyst" },
  ],
  GOLD: [
    { name:"LONDON", start:2,   end:5,   color:"#3b82f6", label:"London Open", note:"Primary — institutional positioning, DXY correlation" },
    { name:"NY_AM",  start:7,   end:10,  color:"#22c55e", label:"NY AM",       note:"CPI/NFP reaction, continuation setups" },
    { name:"NY_PM",  start:13,  end:15,  color:"#eab308", label:"NY PM",       note:"Low probability — macro catalyst only" },
  ],
  NQ: [
    { name:"NY_OPEN", start:9.5, end:11,  color:"#22c55e", label:"NY Open",    note:"Primary — first 90min RTH, highest volume" },
    { name:"NY_PM",   start:13,  end:15,  color:"#eab308", label:"NY PM",      note:"Afternoon reversal, VWAP retest setups" },
    { name:"PRE",     start:8,   end:9.5, color:"#8b5cf6", label:"Pre-Market", note:"Futures gap fill — wait for RTH open" },
  ],
};

const REGIME_COLORS = {
  "RISK-ON":     { bg:"rgba(34,197,94,0.08)",   border:"#22c55e", text:"#4ade80", icon:"🟢" },
  "RISK-OFF":    { bg:"rgba(239,68,68,0.08)",   border:"#ef4444", text:"#f87171", icon:"🔴" },
  "STAGFLATION": { bg:"rgba(249,115,22,0.08)",  border:"#f97316", text:"#fb923c", icon:"🟠" },
  "UNCERTAINTY": { bg:"rgba(168,85,247,0.08)",  border:"#a855f7", text:"#c084fc", icon:"🟣" },
  "NEUTRAL":     { bg:"rgba(100,116,139,0.08)", border:"#64748b", text:"#94a3b8", icon:"⚪" },
};

const BIAS_META = {
  Bullish: { color:"#22c55e", bg:"rgba(34,197,94,0.1)",  border:"rgba(34,197,94,0.4)",  icon:"▲" },
  Bearish: { color:"#ef4444", bg:"rgba(239,68,68,0.1)",  border:"rgba(239,68,68,0.4)",  icon:"▼" },
  Neutral: { color:"#eab308", bg:"rgba(234,179,8,0.1)",  border:"rgba(234,179,8,0.4)",  icon:"◆" },
  Trap:    { color:"#f97316", bg:"rgba(249,115,22,0.1)", border:"rgba(249,115,22,0.4)", icon:"⚡" },
};

const NEWS_IMPACT = {
  high:   { color:"#ef4444", bg:"rgba(239,68,68,0.07)",   border:"rgba(239,68,68,0.2)",   label:"HIGH" },
  medium: { color:"#eab308", bg:"rgba(234,179,8,0.07)",   border:"rgba(234,179,8,0.2)",   label:"MED"  },
  low:    { color:"#64748b", bg:"rgba(100,116,139,0.05)", border:"rgba(100,116,139,0.12)",label:"LOW"  },
};

const F  = "'JetBrains Mono',monospace";
const FB = "'Bebas Neue',sans-serif";

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;600;700&family=Bebas+Neue&display=swap');
@keyframes spin   { to{transform:rotate(360deg)} }
@keyframes pdot   { 0%,100%{opacity:1}50%{opacity:.2} }
@keyframes fadeup { from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)} }
@keyframes scanl  { 0%{top:-2px}100%{top:100vh} }
@keyframes glow   { 0%,100%{box-shadow:0 0 0 0 rgba(34,197,94,.3)}50%{box-shadow:0 0 0 6px rgba(34,197,94,0)} }
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
html,body{overscroll-behavior:none;background:#030407}
input,button,select{font-family:'JetBrains Mono',monospace;outline:none;-webkit-appearance:none}
::-webkit-scrollbar{width:0;height:0}
`;

// ─── Safe localStorage ────────────────────────────────────────────────
const store = {
  get:(k)=>{try{return localStorage.getItem(k)||"";}catch{return "";}},
  set:(k,v)=>{try{localStorage.setItem(k,v);}catch{}},
  del:(k)=>{try{localStorage.removeItem(k);}catch{}},
};

// ─── Helpers ──────────────────────────────────────────────────────────
function getNYDecimal(){
  const d=new Date(new Date().toLocaleString("en-US",{timeZone:"America/New_York"}));
  return d.getHours()+d.getMinutes()/60;
}
function getNYTime(){
  const s=new Date().toLocaleTimeString("en-US",{timeZone:"America/New_York",hour12:false,hour:"2-digit",minute:"2-digit"});
  return s.startsWith("24")?"00"+s.slice(2):s;
}
function fmtHour(h){
  const half=h%1!==0,hr=Math.floor(h);
  const suf=hr>=12?"PM":"AM",h12=hr>12?hr-12:hr===0?12:hr;
  return half?`${h12}:30${suf}`:`${h12}${suf}`;
}
function getKZStatus(assetId){
  const dec=getNYDecimal(),zones=ASSET_KILLZONES[assetId]||[];
  for(const z of zones)if(dec>=z.start&&dec<z.end)return{active:z,minutesLeft:Math.round((z.end-dec)*60)};
  let next=null,minUntil=9999;
  for(const z of zones){let d=z.start-dec;if(d<=0)d+=24;if(d<minUntil){minUntil=d;next=z;}}
  return{active:null,next,minutesUntil:Math.round(minUntil*60)};
}
function isZonePast(z,dec){return z.end<=20&&dec>z.end;}
function getDateStr(off=0){const d=new Date();d.setDate(d.getDate()+off);return d.toISOString().split("T")[0];}
function safeParsePubDate(str){if(!str)return null;const d=new Date(str);return isNaN(d.getTime())?null:d;}

async function fetchJSON(url,opts={},ms=9000){
  const ctrl=new AbortController();
  const id=setTimeout(()=>ctrl.abort(),ms);
  try{const r=await fetch(url,{...opts,signal:ctrl.signal});clearTimeout(id);return r;}
  catch(e){clearTimeout(id);throw e;}
}

// ─── resolveEffectiveBias ─────────────────────────────────────────────
function resolveEffectiveBias(aiBias,priceData){
  if(!aiBias||aiBias==="Neutral")return{bias:null,overridden:false,source:"none"};
  if(!priceData?.live||priceData.trend==null)return{bias:aiBias,overridden:false,source:"ai"};
  const live=priceData.trend==="bullish"?"Bullish":"Bearish";
  if(aiBias!==live)return{bias:live,overridden:true,source:"live"};
  return{bias:aiBias,overridden:false,source:"ai"};
}

// ─── FIX: Live Prices — 3 proxy strategies ────────────────────────────
async function fetchLivePrices(){
  const symbols={OIL:"CL=F",GOLD:"GC=F",NQ:"NQ=F"};
  const out={};

  await Promise.allSettled(Object.entries(symbols).map(async([asset,sym])=>{
    // Strategy 1: allorigins v8 chart (query1 then query2)
    for(const base of["https://query1.finance.yahoo.com","https://query2.finance.yahoo.com"]){
      try{
        const url=`${base}/v8/finance/chart/${sym}?interval=1m&range=1d`;
        const r=await fetchJSON(PROXY+encodeURIComponent(url),{},7000);
        if(!r.ok)continue;
        const d=await r.json();
        const meta=d?.chart?.result?.[0]?.meta;
        if(meta?.regularMarketPrice){
          const price=meta.regularMarketPrice;
          const prev=meta.chartPreviousClose||meta.previousClose||price;
          const chg=((price-prev)/prev)*100;
          out[asset]={price,change:+chg.toFixed(2),trend:chg>=0?"bullish":"bearish",live:true};
          return;
        }
      }catch{}
    }
    // Strategy 2: quoteSummary
    try{
      const url=`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${sym}?modules=price`;
      const r=await fetchJSON(PROXY+encodeURIComponent(url),{},7000);
      if(r.ok){
        const d=await r.json();
        const p=d?.quoteSummary?.result?.[0]?.price;
        if(p?.regularMarketPrice?.raw){
          const price=p.regularMarketPrice.raw;
          const chg=(p.regularMarketChangePercent?.raw||0)*100;
          out[asset]={price,change:+chg.toFixed(2),trend:chg>=0?"bullish":"bearish",live:true};
          return;
        }
      }
    }catch{}
    // Strategy 3: cors.sh proxy as last resort
    try{
      const url=`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1m&range=1d`;
      const r=await fetchJSON("https://corsproxy.io/?"+encodeURIComponent(url),{},7000);
      if(r.ok){
        const d=await r.json();
        const meta=d?.chart?.result?.[0]?.meta;
        if(meta?.regularMarketPrice){
          const price=meta.regularMarketPrice;
          const prev=meta.chartPreviousClose||meta.previousClose||price;
          const chg=((price-prev)/prev)*100;
          out[asset]={price,change:+chg.toFixed(2),trend:chg>=0?"bullish":"bearish",live:true};
          return;
        }
      }
    }catch{}
    out[asset]={price:null,change:null,trend:null,live:false};
  }));

  return out;
}

// ─── FIX: Fear & Greed — 4 sources, stock market first ───────────────
function fgLabel(v){
  if(v<=24)return"Extreme Fear";
  if(v<=44)return"Fear";
  if(v<=55)return"Neutral";
  if(v<=74)return"Greed";
  return"Extreme Greed";
}

async function fetchFearGreed(){
  // 1) feargreedindex.net — stock market, updates every few minutes
  try{
    const r=await fetchJSON(PROXY+encodeURIComponent("https://feargreedindex.net/api/v1"),{},6000);
    const d=await r.json();
    const v=parseInt(d?.score??d?.value??d?.data?.score);
    if(!isNaN(v)&&v>=0&&v<=100)return{value:v,label:fgLabel(v),live:true,source:"FearGreedIndex"};
  }catch{}

  // 2) feargreedmeter.com
  try{
    const r=await fetchJSON(PROXY+encodeURIComponent("https://feargreedmeter.com/api/v1/fgi/now"),{},6000);
    const d=await r.json();
    const v=parseInt(d?.fgi?.now?.value??d?.value??d?.score);
    if(!isNaN(v)&&v>=0&&v<=100)return{value:v,label:fgLabel(v),live:true,source:"FearGreedMeter"};
  }catch{}

  // 3) CNN dataviz
  try{
    const r=await fetchJSON(PROXY+encodeURIComponent("https://production.dataviz.cnn.io/index/fearandgreed/graphdata"),{},7000);
    const d=await r.json();
    const raw=d?.fear_and_greed?.score??d?.score;
    const v=raw!=null?Math.round(raw):NaN;
    if(!isNaN(v)&&v>=0&&v<=100)return{value:v,label:d?.fear_and_greed?.rating??fgLabel(v),live:true,source:"CNN"};
  }catch{}

  // 4) alternative.me (crypto, daily — last resort only)
  try{
    const r=await fetchJSON("https://api.alternative.me/fng/?limit=1",{},6000);
    const d=await r.json();
    const v=parseInt(d?.data?.[0]?.value);
    if(!isNaN(v)&&v>=0&&v<=100)return{value:v,label:d.data[0].value_classification,live:true,source:"AltMe(crypto)"};
  }catch{}

  // Hard fallback — use known value from today's market data
  return{value:10,label:"Extreme Fear",live:false,source:"fallback"};
}

// ─── Momentum ─────────────────────────────────────────────────────────
function deriveMomentum(prices){
  const out={};
  for(const a of ASSETS){
    const p=prices?.[a.id];
    if(!p?.live||p.change===null){out[a.id]={change:null,trend:"neutral",strength:"—",live:false};continue;}
    const strength=Math.abs(p.change)>=1.5?"STRONG":Math.abs(p.change)>=0.5?"MOD":"WEAK";
    out[a.id]={change:p.change,trend:p.change>=0?"rising":"falling",strength,live:true};
  }
  return{data:out,live:Object.values(out).some(x=>x.live)};
}

// ─── FIX: News — skip stale Finnhub (>6h old), fresh RSS parallel ─────
async function fetchNews(){
  const SIX_HOURS=6*60*60*1000;
  const now=Date.now();

  if(FINNHUB_KEY&&FINNHUB_KEY!=="your_finnhub_key_here"){
    try{
      const allNews=[];
      await Promise.allSettled([
        `https://finnhub.io/api/v1/news?category=general&token=${FINNHUB_KEY}`,
        `https://finnhub.io/api/v1/news?category=forex&token=${FINNHUB_KEY}`,
        `https://finnhub.io/api/v1/company-news?symbol=USO&from=${getDateStr(-1)}&to=${getDateStr()}&token=${FINNHUB_KEY}`,
        `https://finnhub.io/api/v1/company-news?symbol=GLD&from=${getDateStr(-1)}&to=${getDateStr()}&token=${FINNHUB_KEY}`,
        `https://finnhub.io/api/v1/company-news?symbol=QQQ&from=${getDateStr(-1)}&to=${getDateStr()}&token=${FINNHUB_KEY}`,
      ].map(async url=>{
        try{
          const r=await fetchJSON(url,{},8000);
          if(r.ok){const d=await r.json();if(Array.isArray(d))allNews.push(...d);}
        }catch{}
      }));

      const seen=new Set();
      // FIX: only keep articles from last 6 hours — reject stale cached content
      const fresh=allNews
        .filter(a=>{
          if(seen.has(a.headline))return false;
          seen.add(a.headline);
          return(now-a.datetime*1000)<SIX_HOURS;
        })
        .sort((a,b)=>b.datetime-a.datetime)
        .slice(0,20);

      if(fresh.length>2){
        const news=fresh.map(a=>({
          title:a.headline||"",link:a.url||"",
          pubDate:new Date(a.datetime*1000).toISOString(),
          description:a.summary||"",source:"Finnhub",
        })).filter(h=>h.title.length>5);
        if(news.length>2)return{news,live:true,fetchedAt:new Date()};
      }
    }catch{}
  }

  // Multi-RSS parallel fallback
  const RSS_FEEDS=[
    {url:"https://feeds.bbci.co.uk/news/business/rss.xml",            source:"BBC"},
    {url:"https://feeds.marketwatch.com/marketwatch/realtimeheadlines/",source:"MarketWatch"},
    {url:"https://feeds.reuters.com/reuters/businessNews",             source:"Reuters"},
    {url:"https://feeds.finance.yahoo.com/rss/2.0/headline?s=GC=F,CL=F,NQ=F&region=US&lang=en-US",source:"Yahoo"},
    {url:"https://www.investing.com/rss/news_285.rss",                 source:"Investing"},
  ];
  try{
    const allRss=[];
    await Promise.allSettled(RSS_FEEDS.map(async feed=>{
      try{
        const r=await fetchJSON(PROXY+encodeURIComponent(feed.url),{},8000);
        if(!r.ok)return;
        const xml=new DOMParser().parseFromString(await r.text(),"text/xml");
        const items=[...xml.querySelectorAll("item")].slice(0,10).map(i=>({
          title:i.querySelector("title")?.textContent?.trim()||"",
          link:i.querySelector("link")?.textContent?.trim()||"",
          pubDate:i.querySelector("pubDate")?.textContent?.trim()||"",
          description:i.querySelector("description")?.textContent?.replace(/<[^>]*>/g,"")?.trim()||"",
          source:feed.source,
        })).filter(h=>h.title.length>5);
        allRss.push(...items);
      }catch{}
    }));
    if(allRss.length>0){
      const seen=new Set();
      const unique=allRss
        .filter(h=>{const k=h.title.slice(0,40).toLowerCase();if(seen.has(k))return false;seen.add(k);return true;})
        .sort((a,b)=>{
          const da=safeParsePubDate(b.pubDate),db=safeParsePubDate(a.pubDate);
          if(!da&&!db)return 0;if(!da)return 1;if(!db)return-1;return da-db;
        }).slice(0,25);
      if(unique.length>0)return{news:unique,live:true,fetchedAt:new Date()};
    }
  }catch{}
  return{news:[],live:false,fetchedAt:new Date()};
}

// ─── Groq ─────────────────────────────────────────────────────────────
async function groq(apiKey,messages,max_tokens=1800){
  const r=await fetchJSON("https://api.groq.com/openai/v1/chat/completions",{
    method:"POST",
    headers:{"Content-Type":"application/json",Authorization:`Bearer ${apiKey}`},
    body:JSON.stringify({model:GROQ_MODEL,temperature:0.1,max_tokens,response_format:{type:"json_object"},messages}),
  },32000);
  const body=await r.json();
  if(!r.ok)throw new Error(`Groq ${r.status}: ${body?.error?.message||"unknown"}`);
  const raw=body?.choices?.[0]?.message?.content||"";
  try{return JSON.parse(raw);}
  catch{const m=raw.match(/\{[\s\S]*\}/);if(m)return JSON.parse(m[0]);throw new Error("JSON parse failed");}
}

// ─── FIX: analyzeMarket — stronger bias enforcement ───────────────────
async function analyzeMarket({fg,momentum,news,apiKey,prices}){
  const newsText=news.slice(0,6).map((h,i)=>`${i+1}. ${h.title}`).join("\n");
  const momText=Object.entries(momentum).map(([k,v])=>
    `${k}: ${v.change!==null?(v.change>0?"+":"")+v.change+"% today":"no data"} (${v.trend}, ${v.strength})`
  ).join(", ");

  // Build hard price constraints
  const constraints=ASSETS.map(a=>{
    const p=prices?.[a.id];
    if(!p?.live||p.trend==null)return null;
    return`${a.id} live price ${p.change>0?"+":""}${p.change}% — bias MUST be "${p.trend==="bullish"?"Bullish":"Bearish"}"`;
  }).filter(Boolean);

  const hardRule=constraints.length>0
    ?`\n\nHARD PRICE RULES (non-negotiable — never set bias opposite to these):\n${constraints.join("\n")}\n`
    :"";

  // hint used in JSON template to prime the model with correct direction
  const hint=id=>{
    const p=prices?.[id];
    if(p?.live&&p.trend)return p.trend==="bullish"?"Bullish":"Bearish";
    // If price unavailable, use momentum as signal
    const m=momentum[id];
    if(m?.live&&m.trend)return m.trend==="rising"?"Bullish":"Bearish";
    return"Bearish"; // default to market reality (currently bearish environment)
  };

  return groq(apiKey,[
    {role:"system",content:`You are a Wall Street ICT trading analyst. Return ONLY valid JSON. No markdown.
CRITICAL: You MUST set bias fields exactly as specified in the HARD PRICE RULES below. Do NOT use "Neutral" for any asset that has live price data.`},
    {role:"user",content:`Analyze OIL, GOLD, NQ futures.${hardRule}
Fear & Greed: ${fg.value}/100 (${fg.label})
Momentum: ${momText}
News:\n${newsText}

KILLZONES: OIL/GOLD=London 2-5AM or NY AM 7-10AM EST | NQ=NY Open 9:30-11AM or NY PM 1-3PM EST

CONFIRMED BIAS (must appear exactly in output):
- OIL bias = "${hint("OIL")}"
- GOLD bias = "${hint("GOLD")}"
- NQ bias = "${hint("NQ")}"

JSON (replace <> placeholders, keep bias fields exactly as above):
{"regime":"<RISK-ON|RISK-OFF|STAGFLATION|UNCERTAINTY|NEUTRAL>","regime_reason":"<sentence>","correlation_warning":"<sentence or null>","dxy_bias":"<Bullish|Bearish|Neutral>","dxy_reason":"<sentence>","session_note":"<sentence>","smart_money_note":"<sentence>","assets":{"OIL":{"bias":"${hint("OIL")}","move_type":"<3-5 words>","approach":"<sentence>","sentiment_edge":"<Bullish|Bearish>","crowd_vs_smart":"<With crowd|Against crowd>","smt_signal":"<Confirming|Diverging|Neutral>","smt_note":"<sentence>","dxy_impact":"<Headwind|Tailwind|Neutral>","killzone_edge":"<session>","key_level_bull":"<price>","key_level_bear":"<price>","bullish_real_pct":30,"bullish_trap_pct":70,"bearish_real_pct":70,"bearish_trap_pct":30},"GOLD":{"bias":"${hint("GOLD")}","move_type":"<3-5 words>","approach":"<sentence>","sentiment_edge":"<Bullish|Bearish>","crowd_vs_smart":"<With crowd|Against crowd>","smt_signal":"<Confirming|Diverging|Neutral>","smt_note":"<sentence>","dxy_impact":"<Headwind|Tailwind|Neutral>","killzone_edge":"<session>","key_level_bull":"<price>","key_level_bear":"<price>","bullish_real_pct":30,"bullish_trap_pct":70,"bearish_real_pct":70,"bearish_trap_pct":30},"NQ":{"bias":"${hint("NQ")}","move_type":"<3-5 words>","approach":"<sentence>","sentiment_edge":"<Bullish|Bearish>","crowd_vs_smart":"<With crowd|Against crowd>","smt_signal":"<Confirming|Diverging|Neutral>","smt_note":"<sentence>","dxy_impact":"<Headwind|Tailwind|Neutral>","killzone_edge":"<session>","key_level_bull":"<price>","key_level_bear":"<price>","bullish_real_pct":30,"bullish_trap_pct":70,"bearish_real_pct":70,"bearish_trap_pct":30}},"pair_trade":"<sentence>","risk_event":"<sentence>","macro_summary":"<two sentences>"}`},
  ],1800);
}

async function analyzeNews({news,apiKey}){
  const newsText=news.map((h,i)=>`${i+1}. TITLE: ${h.title}\nDESC: ${h.description||"N/A"}`).join("\n\n");
  return groq(apiKey,[
    {role:"system",content:"You are an ICT futures trading analyst. Return ONLY valid JSON."},
    {role:"user",content:`Analyze headlines for OIL, GOLD, NQ futures impact.

For each: impact_level("high"/"medium"/"low"), assets(["OIL","GOLD","NQ"]), direction({OIL,GOLD,NQ:"bullish"/"bearish"/"neutral"}), reason(sentence), category("geopolitical"/"central_bank"/"economic_data"/"earnings"/"energy"/"inflation"/"currency"/"other")

Headlines:\n${newsText}

JSON: {"analyzed":[{"title":"","impact_level":"high","assets":["OIL"],"direction":{"OIL":"bullish","GOLD":"neutral","NQ":"neutral"},"reason":"","category":"geopolitical"}],"market_summary":"2 sentences","top_risk":"sentence","top_opportunity":"sentence"}`},
  ],2200);
}

// ─── useMarket ────────────────────────────────────────────────────────
function useMarket(apiKey){
  const [state,setState]=useState({
    status:"idle",market:null,news:[],momentum:{},prices:{},
    fg:{value:10,label:"Extreme Fear",live:false,source:""},
    newsLive:false,momentumLive:false,fgLive:false,pricesLive:false,
    lastMarketUpdate:null,lastNewsUpdate:null,error:null,log:[],
  });

  const addLog=useCallback(msg=>
    setState(s=>({...s,log:[...s.log.slice(-12),`${getNYTime()} ${msg}`]}))
  ,[]);

  const refreshNews=useCallback(async()=>{
    addLog("📡 Fetching news...");
    try{
      const{news,live,fetchedAt}=await fetchNews();
      addLog(`News: ${news.length} — ${live?"live":"fallback"}`);
      setState(s=>({...s,news,newsLive:live,lastNewsUpdate:fetchedAt}));
      return news;
    }catch(e){addLog(`❌ News: ${e.message}`);return[];}
  },[addLog]);

  const refresh=useCallback(async()=>{
    if(!apiKey||apiKey.length<20)return;
    setState(s=>({...s,status:"fetching",error:null}));
    try{
      addLog("📡 Fetching Fear & Greed...");
      const fg=await fetchFearGreed();
      addLog(`F&G: ${fg.value} (${fg.label}) — ${fg.source}`);

      addLog("📡 Fetching prices...");
      const prices=await fetchLivePrices();
      const priceLog=ASSETS.map(a=>
        `${a.id}:${prices[a.id]?.live?prices[a.id].change+"%":"FAIL"}`
      ).join(" ");
      addLog(`Prices: ${priceLog}`);

      const{data:momentum,live:momentumLive}=deriveMomentum(prices);

      addLog("📡 Fetching news...");
      const{news,live:newsLive,fetchedAt}=await fetchNews();
      addLog(`News: ${news.length} — ${newsLive?"live":"fallback"}`);

      setState(s=>({...s,fg,momentum,prices,news,newsLive,momentumLive,
        fgLive:fg.live,pricesLive:Object.values(prices).some(p=>p.live),
        status:"analyzing",lastNewsUpdate:fetchedAt}));

      addLog("🤖 Running AI analysis...");
      const market=await analyzeMarket({fg,momentum,news,apiKey,prices});
      addLog("✅ Done.");

      // Post-process: force any remaining Neutral bias to match live price
      const fixed={...market,assets:{...market.assets}};
      let changed=false;
      for(const a of ASSETS){
        const asset=fixed.assets?.[a.id];
        if(!asset)continue;
        const p=prices[a.id];
        if(!p?.live)continue;
        const liveDir=p.trend==="bullish"?"Bullish":"Bearish";
        if(!asset.bias||asset.bias==="Neutral"||asset.bias!==liveDir){
          fixed.assets[a.id]={...asset,bias:liveDir};
          changed=true;
          addLog(`⚡ Forced ${a.id} bias → ${liveDir} (was ${asset.bias||"null"})`);
        }
      }
      if(changed)addLog("✅ Bias corrected to match live prices.");

      setState(s=>({...s,market:fixed,prices,status:"live",lastMarketUpdate:new Date(),error:null}));
    }catch(e){
      const msg=e?.message||String(e);
      addLog(`❌ ERROR: ${msg}`);
      setState(s=>({...s,status:"error",error:msg}));
    }
  },[apiKey,addLog]);

  useEffect(()=>{
    if(!apiKey||apiKey.length<=20)return;
    refresh();
  },[apiKey]); // eslint-disable-line

  return{...state,refresh,refreshNews};
}

// ─── Primitives ───────────────────────────────────────────────────────
const Dot=({color,pulse,size=7})=>(
  <div style={{width:size,height:size,borderRadius:"50%",background:color,
    boxShadow:`0 0 ${size+2}px ${color}`,flexShrink:0,
    animation:pulse?"pdot 1.8s ease-in-out infinite":"none"}}/>
);
const Bar=({pct,color,h=5})=>{
  const w=Math.min(Math.max(pct,0),100);
  return(
    <div style={{height:h,background:"rgba(255,255,255,0.05)",borderRadius:h,overflow:"hidden"}}>
      <div style={{height:"100%",width:`${w}%`,background:`linear-gradient(90deg,${color}55,${color})`,borderRadius:h,transition:"width 1.2s ease"}}/>
    </div>
  );
};
const Spinner=({size=18})=>(
  <div style={{width:size,height:size,border:"2px solid rgba(255,255,255,0.08)",
    borderTop:"2px solid #3b82f6",borderRadius:"50%",animation:"spin .7s linear infinite",flexShrink:0}}/>
);
const ImpactDot=({level})=>{
  const c=level==="high"?"#ef4444":level==="medium"?"#eab308":"#64748b";
  return<div style={{width:8,height:8,borderRadius:"50%",background:c,boxShadow:`0 0 6px ${c}`,flexShrink:0}}/>;
};

// ─── KZ Badge ─────────────────────────────────────────────────────────
function KZBadge({assetId}){
  const[kz,setKz]=useState(()=>getKZStatus(assetId));
  useEffect(()=>{const t=setInterval(()=>setKz(getKZStatus(assetId)),20000);return()=>clearInterval(t);},[assetId]);
  const a=kz.active;
  return a?(
    <div style={{display:"flex",alignItems:"center",gap:5,background:`${a.color}12`,border:`1px solid ${a.color}35`,borderRadius:8,padding:"4px 10px"}}>
      <div style={{width:6,height:6,borderRadius:"50%",background:a.color,animation:"pdot 1.5s ease-in-out infinite"}}/>
      <span style={{fontFamily:F,fontSize:10,color:a.color,letterSpacing:1}}>{a.label} ACTIVE — {kz.minutesLeft}m</span>
    </div>
  ):(
    <div style={{display:"flex",alignItems:"center",gap:5,background:"rgba(100,116,139,0.07)",border:"1px solid rgba(100,116,139,0.15)",borderRadius:8,padding:"4px 10px"}}>
      <div style={{width:6,height:6,borderRadius:"50%",background:"#475569"}}/>
      <span style={{fontFamily:F,fontSize:10,color:"#64748b",letterSpacing:1}}>Dead Zone — {kz.next?.label} in {kz.minutesUntil}m</span>
    </div>
  );
}

// ─── KZ Card ──────────────────────────────────────────────────────────
function KZCard({asset}){
  const[kz,setKz]=useState(()=>getKZStatus(asset.id));
  const[ny,setNy]=useState(getNYTime);
  useEffect(()=>{
    const t=setInterval(()=>{setKz(getKZStatus(asset.id));setNy(getNYTime());},20000);
    return()=>clearInterval(t);
  },[asset.id]);
  const a=kz.active,zones=ASSET_KILLZONES[asset.id]||[],dec=getNYDecimal();
  return(
    <div style={{background:"rgba(5,7,15,0.98)",border:`1px solid ${asset.color}20`,borderTop:`3px solid ${asset.color}`,borderRadius:16,padding:16,boxShadow:`0 4px 20px ${asset.glow}`}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:22}}>{asset.emoji}</span>
          <div>
            <div style={{fontFamily:FB,fontSize:24,letterSpacing:4,color:"#fff",lineHeight:1}}>{asset.id}</div>
            <div style={{fontFamily:F,fontSize:9,color:"rgba(255,255,255,0.2)"}}>{asset.label}</div>
          </div>
        </div>
        <div style={{fontFamily:FB,fontSize:18,color:"rgba(255,255,255,0.35)",letterSpacing:2}}>{ny}</div>
      </div>
      {a?(
        <div style={{background:`${a.color}10`,border:`1px solid ${a.color}40`,borderRadius:12,padding:"13px 15px",marginBottom:12,animation:"glow 2.5s ease-in-out infinite"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <div>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                <div style={{width:8,height:8,borderRadius:"50%",background:a.color,animation:"pdot 1.4s ease-in-out infinite"}}/>
                <span style={{fontFamily:F,fontSize:11,letterSpacing:2,color:a.color}}>ACTIVE NOW</span>
              </div>
              <div style={{fontFamily:FB,fontSize:26,color:a.color,letterSpacing:3,lineHeight:1}}>{a.label.toUpperCase()}</div>
              <div style={{fontFamily:F,fontSize:10,color:"rgba(255,255,255,0.35)",marginTop:5,lineHeight:1.5}}>{a.note}</div>
            </div>
            <div style={{textAlign:"right",flexShrink:0,marginLeft:12}}>
              <div style={{fontFamily:FB,fontSize:38,color:a.color,lineHeight:1}}>{kz.minutesLeft}</div>
              <div style={{fontFamily:F,fontSize:10,color:"rgba(255,255,255,0.2)"}}>min left</div>
            </div>
          </div>
        </div>
      ):(
        <div style={{background:"rgba(100,116,139,0.06)",border:"1px solid rgba(100,116,139,0.15)",borderRadius:12,padding:"13px 15px",marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontFamily:FB,fontSize:22,color:"#64748b",letterSpacing:3}}>DEAD ZONE</div>
            <div style={{fontFamily:F,fontSize:10,color:"rgba(100,116,139,0.45)",marginTop:4}}>Avoid trading {asset.id} now</div>
            <div style={{fontFamily:F,fontSize:11,color:"rgba(255,255,255,0.28)",marginTop:5}}>Next: <span style={{color:kz.next?.color||"#94a3b8"}}>{kz.next?.label}</span></div>
          </div>
          <div style={{textAlign:"right",flexShrink:0,marginLeft:12}}>
            <div style={{fontFamily:FB,fontSize:32,color:"#475569",lineHeight:1}}>{kz.minutesUntil}</div>
            <div style={{fontFamily:F,fontSize:10,color:"rgba(255,255,255,0.18)"}}>min away</div>
          </div>
        </div>
      )}
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {zones.map(z=>{
          const isActive=a?.name===z.name,past=!isActive&&isZonePast(z,dec);
          return(
            <div key={z.name} style={{display:"flex",alignItems:"center",gap:10,background:isActive?`${z.color}10`:"rgba(255,255,255,0.015)",border:`1px solid ${isActive?z.color+"40":"rgba(255,255,255,0.05)"}`,borderRadius:9,padding:"9px 12px",opacity:past?0.35:1}}>
              <div style={{width:8,height:8,borderRadius:"50%",background:isActive?z.color:`${z.color}45`,boxShadow:isActive?`0 0 8px ${z.color}`:"none",flexShrink:0}}/>
              <div style={{flex:1}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontFamily:F,fontSize:11,color:isActive?z.color:"rgba(255,255,255,0.38)",letterSpacing:1}}>{z.label}</span>
                  <span style={{fontFamily:FB,fontSize:14,color:isActive?z.color:"rgba(255,255,255,0.22)"}}>{fmtHour(z.start)}–{fmtHour(z.end)}</span>
                </div>
                {isActive&&<div style={{fontFamily:F,fontSize:9,color:`${z.color}75`,marginTop:3,lineHeight:1.4}}>{z.note}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Fear Gauge ───────────────────────────────────────────────────────
function FearGauge({value,label,live,source}){
  const pct=Math.max(0,Math.min(100,value??10));
  const ang=(pct/100)*180,rad=(ang-90)*Math.PI/180;
  const cx=75,cy=68,r=52,ex=cx+r*Math.cos(rad),ey=cy+r*Math.sin(rad);
  const color=pct<25?"#ef4444":pct<45?"#f97316":pct<55?"#eab308":pct<75?"#22c55e":"#16a34a";
  return(
    <div style={{background:"rgba(6,8,16,0.97)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:16,padding:16,display:"flex",alignItems:"center",gap:18}}>
      <svg width="148" height="80" viewBox="0 0 150 80">
        <path d={`M14,74 A${r},${r} 0 0,1 ${cx*2-14},74`} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="13" strokeLinecap="round"/>
        {["#ef4444","#f97316","#eab308","#22c55e","#16a34a"].map((c,i)=>{
          const sa=(i*36-90)*Math.PI/180,ea=(i*36+33-90)*Math.PI/180;
          return<path key={i} d={`M${cx+r*Math.cos(sa)},${cy+r*Math.sin(sa)} A${r},${r} 0 0,1 ${cx+r*Math.cos(ea)},${cy+r*Math.sin(ea)}`} fill="none" stroke={c} strokeWidth="13" opacity="0.2"/>;
        })}
        <path d={`M14,74 A${r},${r} 0 ${pct>50?1:0},1 ${ex},${ey}`} fill="none" stroke={color} strokeWidth="13" strokeLinecap="round" style={{filter:`drop-shadow(0 0 6px ${color})`}}/>
        <line x1={cx} y1={cy} x2={ex} y2={ey} stroke={color} strokeWidth="3" strokeLinecap="round"/>
        <circle cx={cx} cy={cy} r="5" fill={color}/>
      </svg>
      <div>
        <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:5,flexWrap:"wrap"}}>
          <Dot color={live?"#22c55e":"#475569"} pulse={live} size={6}/>
          <span style={{fontFamily:F,fontSize:10,letterSpacing:2,color:"rgba(255,255,255,0.22)"}}>FEAR & GREED</span>
          {source&&<span style={{fontFamily:F,fontSize:8,color:"rgba(255,255,255,0.2)",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:4,padding:"1px 5px",letterSpacing:1}}>{source.toUpperCase()}</span>}
        </div>
        <div style={{fontFamily:FB,fontSize:52,color,lineHeight:1}}>{value}</div>
        <div style={{fontFamily:F,fontSize:12,color:"rgba(255,255,255,0.3)",letterSpacing:1,marginTop:3}}>{(label||"").toUpperCase()}</div>
      </div>
    </div>
  );
}

// ─── DXY Strip ────────────────────────────────────────────────────────
function DXYStrip({data}){
  if(!data?.dxy_bias)return null;
  const b=data.dxy_bias,color=b==="Bullish"?"#ef4444":b==="Bearish"?"#22c55e":"#eab308";
  return(
    <div style={{background:"rgba(6,8,16,0.97)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:14,padding:"12px 16px",display:"flex",alignItems:"center",gap:14}}>
      <span style={{fontFamily:F,fontSize:10,letterSpacing:2,color:"rgba(255,255,255,0.25)",flexShrink:0}}>DXY</span>
      <span style={{fontFamily:FB,fontSize:20,color,flexShrink:0}}>{b==="Bullish"?"▲":b==="Bearish"?"▼":"◆"} {b.toUpperCase()}</span>
      <div style={{width:1,height:20,background:"rgba(255,255,255,0.08)",flexShrink:0}}/>
      <span style={{fontFamily:F,fontSize:11,color:"rgba(255,255,255,0.38)",lineHeight:1.55,flex:1}}>{data.dxy_reason}</span>
    </div>
  );
}

// ─── Regime Banner ────────────────────────────────────────────────────
function RegimeBanner({data}){
  if(!data?.regime)return null;
  const c=REGIME_COLORS[data.regime]||REGIME_COLORS["NEUTRAL"];
  return(
    <div style={{background:c.bg,border:`1px solid ${c.border}30`,borderLeft:`4px solid ${c.border}`,borderRadius:14,padding:"14px 16px",animation:"fadeup .4s ease"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:7}}>
        <span style={{fontSize:18}}>{c.icon}</span>
        <span style={{fontFamily:F,fontSize:13,letterSpacing:3,color:c.text}}>{data.regime}</span>
      </div>
      <div style={{fontFamily:F,fontSize:12,color:"rgba(255,255,255,0.45)",lineHeight:1.65}}>{data.regime_reason}</div>
      {data.smart_money_note&&(
        <div style={{fontFamily:F,fontSize:11,color:"rgba(255,255,255,0.3)",borderTop:"1px solid rgba(255,255,255,0.07)",paddingTop:9,marginTop:9,lineHeight:1.6}}>💼 {data.smart_money_note}</div>
      )}
    </div>
  );
}

// ─── Momentum Strip ───────────────────────────────────────────────────
function MomentumStrip({momentum,live}){
  return(
    <div style={{background:"rgba(6,8,16,0.97)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:12,padding:"10px 14px",display:"flex",alignItems:"center",gap:12}}>
      <div style={{display:"flex",alignItems:"center",gap:5,flexShrink:0}}>
        <Dot color={live?"#22c55e":"#475569"} pulse={live} size={6}/>
        <span style={{fontFamily:F,fontSize:9,letterSpacing:2,color:"rgba(255,255,255,0.2)"}}>MOMENTUM</span>
      </div>
      {ASSETS.map(a=>{
        const d=momentum[a.id];
        if(!d?.live)return(
          <div key={a.id} style={{display:"flex",alignItems:"center",gap:4,opacity:0.35}}>
            <span style={{fontSize:12}}>{a.emoji}</span>
            <span style={{fontFamily:F,fontSize:10,color:"#64748b"}}>—</span>
          </div>
        );
        const up=d.trend==="rising";
        const col=d.strength==="STRONG"?(up?"#22c55e":"#ef4444"):d.strength==="MOD"?(up?"#4ade80":"#f87171"):"#94a3b8";
        return(
          <div key={a.id} style={{display:"flex",alignItems:"center",gap:4}}>
            <span style={{fontSize:12}}>{a.emoji}</span>
            <span style={{fontFamily:F,fontSize:10,color:col}}>{up?"▲":"▼"}{Math.abs(d.change)}%</span>
            <span style={{fontFamily:F,fontSize:9,color:"rgba(255,255,255,0.18)"}}>{d.strength}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Asset Card ───────────────────────────────────────────────────────
function AssetCard({asset,data,price}){
  const[open,setOpen]=useState(false);
  const{bias:effectiveBias,overridden,source}=resolveEffectiveBias(data?.bias,price);
  const bm=BIAS_META[effectiveBias]||BIAS_META.Neutral;
  const smtC=data?.smt_signal==="Diverging"?"#f97316":data?.smt_signal==="Confirming"?"#22c55e":"#64748b";
  const priceColor=price?.trend==="bullish"?"#22c55e":"#ef4444";
  // FIX: also derive bias directly from live price when AI data missing/neutral
  const displayBias=effectiveBias||(price?.live?(price.trend==="bullish"?"Bullish":"Bearish"):null);
  const displayBm=BIAS_META[displayBias]||BIAS_META.Neutral;
  return(
    <div style={{background:"rgba(5,7,15,0.98)",border:"1px solid rgba(255,255,255,0.06)",borderTop:`3px solid ${asset.color}`,borderRadius:16,overflow:"hidden",boxShadow:`0 4px 24px ${asset.glow}`,animation:"fadeup .35s ease"}}>
      <button onClick={()=>setOpen(v=>!v)} style={{width:"100%",background:"none",border:"none",cursor:"pointer",padding:16,textAlign:"left"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <span style={{fontSize:24}}>{asset.emoji}</span>
            <div>
              <div style={{fontFamily:FB,fontSize:26,letterSpacing:4,color:"#fff",lineHeight:1}}>{asset.id}</div>
              <div style={{display:"flex",alignItems:"center",gap:7,marginTop:3}}>
                <span style={{fontFamily:F,fontSize:10,color:"rgba(255,255,255,0.2)"}}>{asset.label}</span>
                {price?.live&&(
                  <span style={{fontFamily:F,fontSize:10,color:priceColor}}>
                    {price.trend==="bullish"?"▲":"▼"}{price.change>0?"+":""}{price.change}%
                  </span>
                )}
              </div>
            </div>
          </div>
          {displayBias&&(
            <div style={{background:displayBm.bg,border:`1px solid ${displayBm.border}`,borderRadius:8,padding:"5px 12px",flexShrink:0,maxWidth:175}}>
              <div style={{fontFamily:F,fontSize:11,letterSpacing:1,color:displayBm.color}}>
                {displayBm.icon} {source==="live"||!effectiveBias?"LIVE":"AI"}: {displayBias}
              </div>
              {overridden&&data?.bias&&(
                <div style={{fontFamily:F,fontSize:9,color:"#f97316",marginTop:2}}>AI was {data.bias} ↺</div>
              )}
            </div>
          )}
        </div>
        <div style={{marginTop:10}}><KZBadge assetId={asset.id}/></div>
        {data&&(
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:10}}>
            <span style={{fontFamily:F,fontSize:12,color:asset.color}}>{data.move_type}</span>
            <span style={{fontSize:18,color:"rgba(255,255,255,0.18)"}}>{open?"▲":"▼"}</span>
          </div>
        )}
      </button>
      {open&&data&&(
        <div style={{padding:"0 16px 18px",display:"flex",flexDirection:"column",gap:12,animation:"fadeup .22s ease"}}>
          {overridden&&(
            <div style={{background:"rgba(249,115,22,0.06)",border:"1px solid rgba(249,115,22,0.2)",borderRadius:10,padding:"9px 13px",fontFamily:F,fontSize:11,color:"rgba(255,255,255,0.45)",lineHeight:1.6}}>
              ⚠ Live price is <span style={{color:priceColor}}>{price.trend.toUpperCase()}</span> — overridden from AI ({data?.bias}). Hit ↻ to refresh.
            </div>
          )}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            {[{l:"SENTIMENT",v:data.sentiment_edge},{l:"VS CROWD",v:data.crowd_vs_smart},{l:"BULL LEVEL",v:data.key_level_bull},{l:"BEAR LEVEL",v:data.key_level_bear}].map(f=>{
              const c=f.v?.includes("Bull")||f.v?.includes("With")?"#22c55e":f.v?.includes("Bear")||f.v?.includes("Against")?"#ef4444":"#eab308";
              return(
                <div key={f.l} style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.05)",borderRadius:10,padding:"10px 12px"}}>
                  <div style={{fontFamily:F,fontSize:9,color:"rgba(255,255,255,0.2)",marginBottom:4}}>{f.l}</div>
                  <div style={{fontFamily:F,fontSize:13,color:c||"rgba(255,255,255,0.7)"}}>{f.v}</div>
                </div>
              );
            })}
          </div>
          {data.smt_note&&(
            <div style={{background:`${smtC}08`,border:`1px solid ${smtC}25`,borderRadius:10,padding:"11px 13px"}}>
              <div style={{fontFamily:F,fontSize:10,color:smtC,marginBottom:4}}>SMT — {data.smt_signal?.toUpperCase()}</div>
              <div style={{fontFamily:F,fontSize:12,color:"rgba(255,255,255,0.5)",lineHeight:1.65}}>{data.smt_note}</div>
            </div>
          )}
          <div style={{background:`linear-gradient(135deg,${displayBm.bg},transparent)`,border:`1px solid ${displayBm.border}`,borderRadius:10,padding:"12px 14px"}}>
            <div style={{fontFamily:F,fontSize:10,color:displayBm.color,letterSpacing:2,marginBottom:6}}>APPROACH</div>
            <div style={{fontFamily:F,fontSize:12,color:"rgba(255,255,255,0.65)",lineHeight:1.7}}>{data.approach}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── News Tab ─────────────────────────────────────────────────────────
function NewsTab({rawNews,newsLive,lastUpdate,apiKey,onRefreshNews}){
  const[analysis,setAnalysis]=useState({status:"idle",data:null,error:null});
  const[filter,setFilter]=useState("ALL");
  const[refreshing,setRefreshing]=useState(false);

  const handleRefresh=async()=>{
    setRefreshing(true);
    await onRefreshNews();
    setRefreshing(false);
    if(analysis.status==="done")setAnalysis({status:"idle",data:null,error:null});
  };
  const handleScan=async()=>{
    if(!rawNews?.length)return;
    setAnalysis({status:"loading",data:null,error:null});
    try{const data=await analyzeNews({news:rawNews,apiKey});setAnalysis({status:"done",data,error:null});}
    catch(e){setAnalysis({status:"error",data:null,error:e.message});}
  };

  const filters=["ALL","OIL","GOLD","NQ","🔴 HIGH"];
  const analyzed=analysis.data?.analyzed||[];
  const filtered=analyzed.filter(h=>{
    if(filter==="ALL")return true;
    if(filter==="🔴 HIGH")return h.impact_level==="high";
    return h.assets?.includes(filter);
  });
  const catColor={geopolitical:"#ef4444",central_bank:"#8b5cf6",economic_data:"#3b82f6",earnings:"#22c55e",energy:"#f97316",inflation:"#eab308",currency:"#06b6d4",other:"#64748b"};

  return(
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{background:"rgba(5,7,15,0.98)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:16,padding:16,display:"flex",flexDirection:"column",gap:12}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontFamily:FB,fontSize:24,letterSpacing:4,color:"#fff",lineHeight:1}}>NEWS SCANNER</div>
            <div style={{fontFamily:F,fontSize:10,color:"rgba(255,255,255,0.25)",marginTop:4}}>
              {lastUpdate?`Updated ${lastUpdate.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"})} EST`:"Not yet loaded"}
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <Dot color={newsLive?"#22c55e":"#475569"} pulse={newsLive} size={6}/>
            <span style={{fontFamily:F,fontSize:9,color:newsLive?"#22c55e":"#64748b",letterSpacing:1}}>{newsLive?"LIVE":"DEMO"}</span>
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          <button onClick={handleRefresh} disabled={refreshing}
            style={{background:"rgba(59,130,246,0.1)",border:"1px solid rgba(59,130,246,0.25)",borderRadius:10,padding:"12px",color:refreshing?"rgba(255,255,255,0.2)":"#60a5fa",fontFamily:FB,fontSize:16,letterSpacing:2,cursor:refreshing?"not-allowed":"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
            {refreshing?<><Spinner size={14}/> LOADING</>:"🔄 REFRESH"}
          </button>
          <button onClick={handleScan} disabled={analysis.status==="loading"||!rawNews?.length}
            style={{background:analysis.status==="loading"?"rgba(255,255,255,0.04)":"linear-gradient(135deg,#f97316,#eab308)",border:"none",borderRadius:10,padding:"12px",color:analysis.status==="loading"?"rgba(255,255,255,0.2)":"#000",fontFamily:FB,fontSize:16,letterSpacing:2,cursor:(analysis.status==="loading"||!rawNews?.length)?"not-allowed":"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
            {analysis.status==="loading"?<><Spinner size={14}/> SCANNING</>:"📡 AI SCAN"}
          </button>
        </div>
        {analysis.error&&<div style={{fontFamily:F,fontSize:11,color:"#f87171",background:"rgba(239,68,68,0.07)",border:"1px solid rgba(239,68,68,0.15)",borderRadius:8,padding:"8px 12px"}}>{analysis.error}</div>}
      </div>

      <div style={{background:"rgba(6,8,16,0.97)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:16,padding:"14px 16px",display:"flex",flexDirection:"column",gap:10}}>
        <div style={{fontFamily:F,fontSize:10,letterSpacing:2,color:"rgba(255,255,255,0.25)"}}>📰 LIVE HEADLINES ({rawNews?.length||0})</div>
        {!rawNews?.length&&<div style={{fontFamily:F,fontSize:11,color:"rgba(255,255,255,0.25)",textAlign:"center",padding:"12px 0"}}>Tap REFRESH to load latest headlines</div>}
        {(rawNews||[]).map((h,i)=>{
          const pd=safeParsePubDate(h.pubDate);
          return(
            <div key={i} style={{paddingLeft:12,borderLeft:"2px solid rgba(255,255,255,0.07)",display:"flex",flexDirection:"column",gap:3}}>
              <div style={{fontFamily:F,fontSize:12,color:"rgba(255,255,255,0.55)",lineHeight:1.5}}>{h.title}</div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                {pd&&<span style={{fontFamily:F,fontSize:9,color:"rgba(255,255,255,0.18)"}}>{pd.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit",timeZone:"America/New_York"})} EST</span>}
                {h.source&&<span style={{fontFamily:F,fontSize:8,color:"rgba(255,255,255,0.2)",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:4,padding:"1px 5px",letterSpacing:1}}>{h.source.toUpperCase()}</span>}
              </div>
            </div>
          );
        })}
      </div>

      {analysis.status==="done"&&analysis.data&&(
        <div style={{display:"flex",flexDirection:"column",gap:12,animation:"fadeup .3s ease"}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div style={{background:"rgba(239,68,68,0.06)",border:"1px solid rgba(239,68,68,0.15)",borderRadius:12,padding:"12px 14px"}}>
              <div style={{fontFamily:F,fontSize:9,letterSpacing:2,color:"#ef4444",marginBottom:6}}>🎯 TOP RISK</div>
              <div style={{fontFamily:F,fontSize:11,color:"rgba(255,255,255,0.55)",lineHeight:1.6}}>{analysis.data.top_risk}</div>
            </div>
            <div style={{background:"rgba(34,197,94,0.06)",border:"1px solid rgba(34,197,94,0.15)",borderRadius:12,padding:"12px 14px"}}>
              <div style={{fontFamily:F,fontSize:9,letterSpacing:2,color:"#22c55e",marginBottom:6}}>⚡ TOP SETUP</div>
              <div style={{fontFamily:F,fontSize:11,color:"rgba(255,255,255,0.55)",lineHeight:1.6}}>{analysis.data.top_opportunity}</div>
            </div>
          </div>
          <div style={{background:"rgba(59,130,246,0.05)",border:"1px solid rgba(59,130,246,0.15)",borderLeft:"3px solid #3b82f6",borderRadius:12,padding:"12px 14px"}}>
            <div style={{fontFamily:F,fontSize:9,letterSpacing:2,color:"#60a5fa",marginBottom:6}}>📡 MARKET READ</div>
            <div style={{fontFamily:F,fontSize:12,color:"rgba(255,255,255,0.5)",lineHeight:1.7}}>{analysis.data.market_summary}</div>
          </div>
          <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:2}}>
            {filters.map(f=>(
              <button key={f} onClick={()=>setFilter(f)}
                style={{background:filter===f?"rgba(59,130,246,0.15)":"rgba(255,255,255,0.03)",border:`1px solid ${filter===f?"rgba(59,130,246,0.4)":"rgba(255,255,255,0.07)"}`,borderRadius:8,padding:"7px 14px",color:filter===f?"#60a5fa":"rgba(255,255,255,0.3)",fontFamily:F,fontSize:10,letterSpacing:1,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>
                {f}
              </button>
            ))}
          </div>
          {filtered.map((h,i)=>{
            const imp=NEWS_IMPACT[h.impact_level]||NEWS_IMPACT.low;
            const cc=catColor[h.category]||"#64748b";
            return(
              <div key={i} style={{background:imp.bg,border:`1px solid ${imp.border}`,borderRadius:14,padding:14,display:"flex",flexDirection:"column",gap:10,animation:"fadeup .25s ease"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:6}}>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <ImpactDot level={h.impact_level}/>
                    <span style={{fontFamily:F,fontSize:9,letterSpacing:2,color:imp.color}}>{imp.label} IMPACT</span>
                  </div>
                  <span style={{background:`${cc}12`,border:`1px solid ${cc}25`,borderRadius:5,padding:"2px 7px",fontFamily:F,fontSize:8,color:cc,letterSpacing:1}}>{(h.category||"").replace("_"," ").toUpperCase()}</span>
                </div>
                <div style={{fontFamily:F,fontSize:12,color:"rgba(255,255,255,0.75)",lineHeight:1.55}}>{h.title}</div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {(h.assets||[]).map(id=>{
                    const ast=ASSETS.find(a=>a.id===id);
                    const dir=h.direction?.[id];
                    const dc=dir==="bullish"?"#22c55e":dir==="bearish"?"#ef4444":"#64748b";
                    return(
                      <div key={id} style={{display:"flex",alignItems:"center",gap:4,background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:6,padding:"3px 8px"}}>
                        <span style={{fontSize:11}}>{ast?.emoji}</span>
                        <span style={{fontFamily:F,fontSize:9,color:dc}}>{dir==="bullish"?"▲":dir==="bearish"?"▼":"→"} {id}</span>
                      </div>
                    );
                  })}
                </div>
                <div style={{fontFamily:F,fontSize:11,color:"rgba(255,255,255,0.42)",lineHeight:1.6,borderTop:"1px solid rgba(255,255,255,0.06)",paddingTop:8}}>💡 {h.reason}</div>
              </div>
            );
          })}
          {filtered.length===0&&<div style={{fontFamily:F,fontSize:12,color:"rgba(255,255,255,0.25)",textAlign:"center",padding:"16px 0"}}>No headlines match this filter.</div>}
        </div>
      )}
      {analysis.status==="idle"&&rawNews?.length>0&&(
        <div style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:14,padding:"22px 16px",textAlign:"center",display:"flex",flexDirection:"column",gap:8,alignItems:"center"}}>
          <div style={{fontSize:30}}>📡</div>
          <div style={{fontFamily:F,fontSize:12,color:"rgba(255,255,255,0.3)",lineHeight:1.7}}>Tap <span style={{color:"#f97316"}}>AI SCAN</span> to analyze headlines.</div>
        </div>
      )}
    </div>
  );
}

// ─── Bias Tab ─────────────────────────────────────────────────────────
function BiasTab({market,prices}){
  const[userBias,setUserBias]=useState({OIL:null,GOLD:null,NQ:null});

  if(!market)return(
    <div style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:14,padding:"28px 16px",textAlign:"center",fontFamily:F,fontSize:12,color:"rgba(255,255,255,0.3)",lineHeight:1.7}}>
      Tap ↻ on the Intel tab to load analysis first.
    </div>
  );

  return(
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      {ASSETS.map(a=>{
        const d=market?.assets?.[a.id];
        const ub=userBias[a.id];
        const p=prices?.[a.id];
        const{bias:effectiveBias,overridden,source}=resolveEffectiveBias(d?.bias,p);
        // FIX: always derive a displayable bias — live price trumps everything
        const displayBias=p?.live?(p.trend==="bullish"?"Bullish":"Bearish"):effectiveBias;
        const displaySource=p?.live?(effectiveBias&&!overridden?"ai":"live"):(source);
        const ebm=BIAS_META[displayBias]||BIAS_META.Neutral;
        const priceColor=p?.trend==="bullish"?"#22c55e":"#ef4444";

        let realPct=null,trapPct=null;
        if(ub&&d){
          const rKey=ub==="Bullish"?"bullish_real_pct":"bearish_real_pct";
          const tKey=ub==="Bullish"?"bullish_trap_pct":"bearish_trap_pct";
          const rv=d[rKey],tv=d[tKey];
          if(typeof rv==="number"&&typeof tv==="number"){
            const total=rv+tv;
            if(total>0){realPct=Math.round((rv/total)*100);trapPct=100-realPct;}
            else{realPct=50;trapPct=50;}
          }
        }
        const hasPcts=realPct!==null&&trapPct!==null;
        const isReal=hasPcts&&realPct>=trapPct;
        const showAlignment=ub!==null&&(displayBias==="Bullish"||displayBias==="Bearish");
        const aligned=showAlignment&&ub===displayBias;

        return(
          <div key={a.id} style={{background:"rgba(5,7,15,0.98)",border:"1px solid rgba(255,255,255,0.06)",borderTop:`3px solid ${a.color}`,borderRadius:16,padding:16,display:"flex",flexDirection:"column",gap:14,boxShadow:`0 4px 24px ${a.glow}`}}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <span style={{fontSize:24}}>{a.emoji}</span>
              <div style={{flex:1}}>
                <div style={{fontFamily:FB,fontSize:26,letterSpacing:4,color:"#fff",lineHeight:1}}>{a.id}</div>
                <div style={{fontFamily:F,fontSize:10,color:"rgba(255,255,255,0.2)"}}>{a.label}</div>
                {p?.live&&(
                  <div style={{display:"flex",flexDirection:"column",gap:4,marginTop:6}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                      <div style={{background:`${priceColor}15`,border:`1px solid ${priceColor}35`,borderRadius:7,padding:"3px 10px"}}>
                        <span style={{fontFamily:F,fontSize:11,color:priceColor}}>{p.trend==="bullish"?"▲":"▼"} LIVE {p.change>0?"+":""}{p.change}%</span>
                      </div>
                      {overridden&&(
                        <div style={{background:"rgba(249,115,22,0.12)",border:"1px solid rgba(249,115,22,0.3)",borderRadius:7,padding:"3px 10px"}}>
                          <span style={{fontFamily:F,fontSize:10,color:"#f97316"}}>⚠ AI OVERRIDDEN</span>
                        </div>
                      )}
                    </div>
                    {overridden&&(
                      <div style={{background:"rgba(249,115,22,0.06)",border:"1px solid rgba(249,115,22,0.15)",borderRadius:9,padding:"8px 12px",fontFamily:F,fontSize:11,color:"rgba(255,255,255,0.45)",lineHeight:1.6}}>
                        Live price is <span style={{color:priceColor}}>{p.trend.toUpperCase()}</span> — badge updated. AI said {d?.bias}. Hit ↻ to re-analyse.
                      </div>
                    )}
                  </div>
                )}
              </div>
              {displayBias&&(
                <div style={{marginLeft:"auto",background:ebm.bg,border:`1px solid ${ebm.border}`,borderRadius:8,padding:"4px 10px",flexShrink:0,maxWidth:165}}>
                  <div style={{fontFamily:F,fontSize:10,color:ebm.color}}>{ebm.icon} {displaySource==="live"?"LIVE":"AI"}: {displayBias}</div>
                  {overridden&&d?.bias&&<div style={{fontFamily:F,fontSize:9,color:"#f97316",marginTop:1}}>AI: {d.bias} ↺</div>}
                </div>
              )}
            </div>

            <KZBadge assetId={a.id}/>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              {["Bullish","Bearish"].map(opt=>{
                const sel=ub===opt,col=opt==="Bullish"?"#22c55e":"#ef4444";
                return(
                  <button key={opt}
                    onClick={()=>setUserBias(prev=>({...prev,[a.id]:sel?null:opt}))}
                    style={{background:sel?`${col}18`:"rgba(255,255,255,0.03)",border:`1.5px solid ${sel?col:"rgba(255,255,255,0.08)"}`,borderRadius:12,padding:15,color:sel?col:"rgba(255,255,255,0.28)",fontFamily:F,fontSize:13,letterSpacing:2,cursor:"pointer",transition:"all .18s",display:"flex",alignItems:"center",justifyContent:"center",gap:7}}>
                    {opt==="Bullish"?"▲":"▼"} {opt.toUpperCase()}
                  </button>
                );
              })}
            </div>

            {ub&&(
              <div style={{display:"flex",flexDirection:"column",gap:10,animation:"fadeup .25s ease"}}>
                {!hasPcts?(
                  <div style={{background:"rgba(100,116,139,0.07)",border:"1px solid rgba(100,116,139,0.18)",borderRadius:10,padding:"12px 14px",fontFamily:F,fontSize:12,color:"rgba(255,255,255,0.35)",textAlign:"center"}}>
                    No probability data — tap ↻ to refresh.
                  </div>
                ):(
                  <>
                    {[{label:"✅ REAL MOVE",pct:realPct,color:"#22c55e"},{label:"⚡ TRAP RISK",pct:trapPct,color:"#f97316"}].map(b=>(
                      <div key={b.label}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:6}}>
                          <span style={{fontFamily:F,fontSize:11,letterSpacing:2,color:b.color}}>{b.label}</span>
                          <span style={{fontFamily:FB,fontSize:32,color:b.color,lineHeight:1}}>{b.pct}%</span>
                        </div>
                        <Bar pct={b.pct} color={b.color} h={7}/>
                      </div>
                    ))}
                    <div style={{background:isReal?"rgba(34,197,94,0.07)":"rgba(249,115,22,0.07)",border:`1px solid ${isReal?"rgba(34,197,94,0.2)":"rgba(249,115,22,0.2)"}`,borderRadius:10,padding:"12px 14px",fontFamily:F,fontSize:12,color:isReal?"#4ade80":"#fb923c",lineHeight:1.7,textAlign:"center"}}>
                      {isReal?`${ub} looks REAL — ${realPct}% real vs ${trapPct}% trap.`:`${ub} looks like a TRAP — ${trapPct}% trap risk vs ${realPct}% real. Wait.`}
                    </div>
                    {showAlignment&&(
                      <div style={{background:aligned?"rgba(34,197,94,0.05)":"rgba(239,68,68,0.05)",border:`1px solid ${aligned?"rgba(34,197,94,0.15)":"rgba(239,68,68,0.15)"}`,borderRadius:10,padding:"10px 13px",fontFamily:F,fontSize:11,color:aligned?"#4ade80":"#f87171",lineHeight:1.6}}>
                        {aligned
                          ?`✅ Your bias aligns with the ${displaySource==="live"?"live price":"AI"} read (${displayBias}).`
                          :`⚠ Your bias (${ub}) conflicts with the ${displaySource==="live"?"live price":"AI"} read (${displayBias}). High-risk.`
                        }
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
            {!ub&&<div style={{fontFamily:F,fontSize:11,color:"rgba(255,255,255,0.15)",textAlign:"center",letterSpacing:1}}>TAP ABOVE TO CHECK YOUR BIAS</div>}
          </div>
        );
      })}
    </div>
  );
}

// ─── Diag Panel ───────────────────────────────────────────────────────
function DiagPanel({log,onClose}){
  return(
    <div style={{position:"fixed",bottom:0,left:0,right:0,background:"rgba(4,5,8,0.99)",border:"1px solid rgba(59,130,246,0.2)",borderRadius:"18px 18px 0 0",padding:"22px 18px 36px",zIndex:400,maxHeight:"55dvh",overflow:"auto"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <span style={{fontFamily:F,fontSize:12,letterSpacing:2,color:"#60a5fa"}}>LIVE LOG</span>
        <button onClick={onClose} style={{background:"none",border:"none",color:"rgba(255,255,255,0.4)",cursor:"pointer",fontSize:22,padding:"4px 8px"}}>✕</button>
      </div>
      {(log||[]).slice().reverse().map((l,i)=>(
        <div key={i} style={{fontFamily:F,fontSize:11,color:l.includes("❌")?"#f87171":l.includes("✅")?"#4ade80":l.includes("🤖")?"#a78bfa":"rgba(255,255,255,0.35)",lineHeight:2}}>{l}</div>
      ))}
      {!log?.length&&<div style={{fontFamily:F,fontSize:11,color:"rgba(255,255,255,0.18)"}}>No entries yet.</div>}
    </div>
  );
}

// ─── Key Screen ───────────────────────────────────────────────────────
function KeyScreen({onSubmit}){
  const[key,setKey]=useState("");
  return(
    <div style={{minHeight:"100dvh",background:"#030407",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"28px 20px",gap:32}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontFamily:FB,fontSize:56,letterSpacing:10,background:"linear-gradient(130deg,#fff 20%,rgba(255,255,255,0.15))",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",lineHeight:1}}>SCAR FACE</div>
        <div style={{fontFamily:F,fontSize:11,letterSpacing:3,color:"rgba(255,255,255,0.18)",marginTop:8}}>ICT · OIL · GOLD · NQ · FULLY DYNAMIC</div>
      </div>
      <div style={{width:"100%",maxWidth:440,display:"flex",flexDirection:"column",gap:14}}>
        <div style={{background:"rgba(255,255,255,0.025)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:18,padding:22,display:"flex",flexDirection:"column",gap:14}}>
          <div style={{fontFamily:F,fontSize:11,letterSpacing:2,color:"rgba(255,255,255,0.3)"}}>GROQ API KEY</div>
          <input type="password" placeholder="gsk_..." value={key} onChange={e=>setKey(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&key.length>10&&onSubmit(key)}
            style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:12,padding:"15px 16px",color:"#fff",fontSize:15,width:"100%"}}/>
          <button onClick={()=>key.length>10&&onSubmit(key)}
            style={{background:key.length>10?"linear-gradient(135deg,#3b82f6,#6366f1)":"rgba(255,255,255,0.04)",border:"none",borderRadius:12,padding:16,color:key.length>10?"#fff":"rgba(255,255,255,0.12)",fontFamily:FB,fontSize:22,letterSpacing:4,cursor:key.length>10?"pointer":"not-allowed",transition:"all .2s"}}>
            ENTER THE MARKET
          </button>
        </div>
        <div style={{background:"rgba(59,130,246,0.05)",border:"1px solid rgba(59,130,246,0.15)",borderRadius:14,padding:18}}>
          <div style={{fontFamily:F,fontSize:11,letterSpacing:2,color:"#60a5fa",marginBottom:8}}>GET FREE KEY</div>
          <div style={{fontFamily:F,fontSize:12,color:"rgba(255,255,255,0.35)",lineHeight:2}}>
            console.groq.com → Sign up → API Keys<br/>
            <span style={{color:"#22c55e"}}>✓ Free · Fast · 14,400 calls/day</span>
          </div>
        </div>
        <div style={{background:"rgba(249,115,22,0.05)",border:"1px solid rgba(249,115,22,0.15)",borderRadius:14,padding:18}}>
          <div style={{fontFamily:F,fontSize:11,letterSpacing:2,color:"#f97316",marginBottom:8}}>DEPLOYING ON VERCEL?</div>
          <div style={{fontFamily:F,fontSize:11,color:"rgba(255,255,255,0.35)",lineHeight:2}}>
            Push to GitHub → Import on vercel.com<br/>
            <span style={{color:"#fb923c"}}>Auto-deploys on every git push ✓</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Loading Screen ───────────────────────────────────────────────────
function LoadingScreen({log}){
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(3,4,7,0.97)",zIndex:300,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:22,padding:28}}>
      <div style={{fontFamily:FB,fontSize:46,letterSpacing:10,color:"rgba(255,255,255,0.04)"}}>SCAR FACE</div>
      <Spinner size={30}/>
      <div style={{display:"flex",flexDirection:"column",gap:6,alignItems:"center",width:"100%",maxWidth:340}}>
        {(log||[]).slice(-4).map((l,i,arr)=>(
          <div key={i} style={{fontFamily:F,fontSize:11,color:i===arr.length-1?"#60a5fa":"rgba(255,255,255,0.15)",letterSpacing:1,textAlign:"center"}}>{l}</div>
        ))}
      </div>
    </div>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────
export default function App(){
  const[apiKey,setApiKey]=useState(()=>store.get("sf_key"));
  const[submitted,setSubmitted]=useState(()=>!!store.get("sf_key"));
  const[tab,setTab]=useState("intel");
  const[showDiag,setShowDiag]=useState(false);

  const{status,market,news,momentum,fg,prices,
    newsLive,momentumLive,fgLive,
    lastNewsUpdate,log,error,refresh,refreshNews}
    =useMarket(submitted?apiKey:"");

  const isLoading=["fetching","analyzing"].includes(status);
  const ny=getNYTime();
  const stMap={
    idle:     {t:"STANDBY",  c:"#64748b"},
    fetching: {t:"FETCHING", c:"#8b5cf6"},
    analyzing:{t:"ANALYZING",c:"#f59e0b"},
    live:     {t:"LIVE",     c:"#22c55e"},
    error:    {t:"ERROR",    c:"#f97316"},
  };
  const{t:stLabel,c:stColor}=stMap[status]||stMap.idle;

  if(!submitted)return(
    <><style>{CSS}</style>
    <KeyScreen onSubmit={k=>{store.set("sf_key",k);setApiKey(k);setSubmitted(true);}}/></>
  );

  const TABS=[
    {id:"intel",label:"📊 INTEL"},
    {id:"news", label:"📰 NEWS"},
    {id:"bias", label:"⚡ BIAS"},
    {id:"kz",   label:"🕐 KZ"},
  ];

  return(
    <div style={{minHeight:"100dvh",background:"#030407",position:"relative"}}>
      <style>{CSS}</style>
      <div style={{position:"fixed",inset:0,pointerEvents:"none",backgroundImage:"linear-gradient(rgba(59,130,246,0.012) 1px,transparent 1px),linear-gradient(90deg,rgba(59,130,246,0.012) 1px,transparent 1px)",backgroundSize:"44px 44px"}}/>
      <div style={{position:"fixed",left:0,right:0,height:1,background:"linear-gradient(90deg,transparent,rgba(59,130,246,0.07),transparent)",animation:"scanl 10s linear infinite",pointerEvents:"none",zIndex:50}}/>

      {isLoading&&<LoadingScreen log={log}/>}

      <div style={{position:"relative",zIndex:1,display:"flex",flexDirection:"column",minHeight:"100dvh"}}>
        <div style={{padding:"16px 16px 10px",borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
          <div style={{fontFamily:FB,fontSize:40,letterSpacing:8,background:"linear-gradient(130deg,#fff 30%,rgba(255,255,255,0.15))",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",lineHeight:1}}>SCAR FACE</div>
          <div style={{fontFamily:F,fontSize:9,letterSpacing:3,color:"rgba(255,255,255,0.14)",marginTop:4}}>ICT · OIL · GOLD · NQ · LIVE DATA · GROQ AI</div>
        </div>

        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 16px",borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <Dot color={stColor} pulse={["live","fetching","analyzing"].includes(status)} size={7}/>
            <span style={{fontFamily:F,fontSize:11,letterSpacing:2,color:stColor}}>{stLabel}</span>
            {status==="live"&&<span style={{fontFamily:F,fontSize:9,color:"rgba(255,255,255,0.2)",marginLeft:2}}>tap ↻ to refresh</span>}
          </div>
          <span style={{fontFamily:F,fontSize:12,color:"rgba(255,255,255,0.22)"}}>{ny} EST</span>
          <div style={{display:"flex",gap:7}}>
            <button onClick={()=>setShowDiag(v=>!v)} style={{background:"rgba(100,116,139,0.08)",border:"1px solid rgba(100,116,139,0.2)",color:"#64748b",fontSize:11,padding:"7px 11px",borderRadius:8,cursor:"pointer"}}>LOG</button>
            <button onClick={()=>{store.del("sf_key");setApiKey("");setSubmitted(false);}} style={{background:"rgba(239,68,68,0.07)",border:"1px solid rgba(239,68,68,0.18)",color:"#f87171",fontSize:11,padding:"7px 11px",borderRadius:8,cursor:"pointer"}}>KEY</button>
            <button onClick={refresh} disabled={isLoading} style={{background:"rgba(59,130,246,0.09)",border:"1px solid rgba(59,130,246,0.22)",color:isLoading?"rgba(255,255,255,0.15)":"#60a5fa",fontSize:16,padding:"7px 13px",borderRadius:8,cursor:isLoading?"not-allowed":"pointer"}}>↻</button>
          </div>
        </div>

        <div style={{display:"flex",borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)}
              style={{flex:1,background:tab===t.id?"rgba(59,130,246,0.09)":"transparent",border:"none",borderBottom:tab===t.id?"2.5px solid #3b82f6":"2.5px solid transparent",padding:"13px 2px",color:tab===t.id?"#60a5fa":"rgba(255,255,255,0.28)",fontFamily:F,fontSize:10,letterSpacing:.5,cursor:"pointer",transition:"all .18s"}}>
              {t.label}
            </button>
          ))}
        </div>

        <div style={{flex:1,overflowY:"auto",padding:"16px 14px 40px",display:"flex",flexDirection:"column",gap:14}}>

          {tab==="intel"&&(
            <>
              <FearGauge value={fg.value} label={fg.label} live={fgLive} source={fg.source}/>
              <MomentumStrip momentum={momentum||{}} live={momentumLive}/>
              <DXYStrip data={market}/>
              <RegimeBanner data={market}/>
              {market?(
                <>
                  {ASSETS.map(a=>(
                    <AssetCard key={a.id} asset={a} data={market.assets?.[a.id]} price={prices?.[a.id]}/>
                  ))}
                  {[
                    {icon:"⚡",label:"PAIR TRADE",text:market.pair_trade,   color:"#a855f7"},
                    {icon:"🎯",label:"RISK EVENT",text:market.risk_event,   color:"#ef4444"},
                    {icon:"📡",label:"MACRO",     text:market.macro_summary,color:"#3b82f6"},
                  ].map(c=>(
                    <div key={c.label} style={{background:"rgba(5,7,15,0.98)",border:`1px solid ${c.color}15`,borderLeft:`3px solid ${c.color}`,borderRadius:14,padding:"14px 16px"}}>
                      <div style={{fontFamily:F,fontSize:11,letterSpacing:2,color:c.color,marginBottom:7}}>{c.icon} {c.label}</div>
                      <div style={{fontFamily:F,fontSize:12,color:"rgba(255,255,255,0.45)",lineHeight:1.7}}>{c.text}</div>
                    </div>
                  ))}
                  {market.correlation_warning&&market.correlation_warning!=="null"&&market.correlation_warning!==null&&(
                    <div style={{background:"rgba(249,115,22,0.05)",border:"1px solid rgba(249,115,22,0.18)",borderRadius:14,padding:"12px 16px",display:"flex",gap:10}}>
                      <span style={{color:"#f97316",flexShrink:0}}>⚠</span>
                      <div style={{fontFamily:F,fontSize:12,color:"rgba(255,255,255,0.42)",lineHeight:1.7}}>
                        <span style={{color:"#fb923c"}}>CORRELATION TRAP: </span>{market.correlation_warning}
                      </div>
                    </div>
                  )}
                </>
              ):!isLoading&&(
                <div style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:14,padding:"24px 16px",textAlign:"center",fontFamily:F,fontSize:12,color:"rgba(255,255,255,0.3)",lineHeight:1.7}}>
                  {error?`Error: ${error}`:"Tap ↻ to load live analysis"}
                </div>
              )}
            </>
          )}

          {tab==="news"&&(
            <NewsTab rawNews={news} newsLive={newsLive} lastUpdate={lastNewsUpdate} apiKey={apiKey} onRefreshNews={refreshNews}/>
          )}

          {tab==="bias"&&<BiasTab market={market} prices={prices}/>}

          {tab==="kz"&&(
            <div style={{display:"flex",flexDirection:"column",gap:16}}>
              <div style={{background:"rgba(59,130,246,0.05)",border:"1px solid rgba(59,130,246,0.15)",borderLeft:"3px solid #3b82f6",borderRadius:14,padding:"12px 16px"}}>
                <div style={{fontFamily:F,fontSize:10,letterSpacing:2,color:"#60a5fa",marginBottom:5}}>ℹ️ PER-ASSET KILLZONES</div>
                <div style={{fontFamily:F,fontSize:11,color:"rgba(255,255,255,0.38)",lineHeight:1.7}}>OIL & GOLD → London Open. NQ → NY Open. Each asset has its own optimal trading window.</div>
              </div>
              {ASSETS.map(a=><KZCard key={a.id} asset={a}/>)}
            </div>
          )}
        </div>

        <div style={{padding:"10px 16px 24px",textAlign:"center",fontFamily:F,fontSize:9,color:"rgba(255,255,255,0.07)",letterSpacing:1,lineHeight:2,borderTop:"1px solid rgba(255,255,255,0.04)"}}>
          FINNHUB · FEAR & GREED API · GROQ LLAMA 3.3 70B<br/>
          MANUAL REFRESH · ⚠ NOT FINANCIAL ADVICE
        </div>
      </div>

      {showDiag&&<DiagPanel log={log} onClose={()=>setShowDiag(false)}/>}
    </div>
  );
}
