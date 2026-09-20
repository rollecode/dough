import { getDb } from "./db";

// Prices, day change and the sparklines the investments page draws, from Yahoo for a listed
// symbol and from Seligson's own pages for their funds. Cached in the database for a quarter of
// an hour, because both clients ask for the same handful of symbols.

const YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart";
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const SELIGSON_BASE = "https://www.seligson.fi/suomi/rahastot";

// Seligson fund slug mapping — users set ticker to "SELIGSON:brands" etc.
const SELIGSON_FUNDS: Record<string, { slug: string; name: string }> = {
  brands: { slug: "rahes_brands", name: "Seligson Global Top 25 Brands" },
  suomi: { slug: "rahes_suomi", name: "Seligson Finland Index" },
  phoebus: { slug: "rahes_phoebus", name: "Seligson Phoebus" },
  pharos: { slug: "rahes_pharos", name: "Seligson Pharos" },
  eurooppa: { slug: "rahes_eurooppa", name: "Seligson Eurooppa" },
  pohjoismaat: { slug: "rahes_pohjoismaat", name: "Seligson Pohjoismaat" },
  pharma: { slug: "rahes_pharma", name: "Seligson Pharma" },
  aasia: { slug: "rahes_aasia", name: "Seligson Aasia" },
  perhe: { slug: "rahes_perhe", name: "Seligson Family Business" },
};

async function fetchSeligson(fundKey: string): Promise<TickerData | null> {
  const fund = SELIGSON_FUNDS[fundKey.toLowerCase()];
  if (!fund) {
    console.warn("[ticker] Unknown Seligson fund:", fundKey);
    return null;
  }

  console.info("[ticker] Scraping Seligson", fund.name);
  try {
    const res = await fetch(`${SELIGSON_BASE}/${fund.slug}.htm`, {
      headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36" },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return null;
    const html = await res.text();

    // Parse NAV from: <td data-label="Kasvu (A)">18,059 €</td>
    const navMatch = html.match(/data-label="Kasvu \(A\)">([\d,]+)\s*€/);
    if (!navMatch) {
      console.warn("[ticker] Could not parse Seligson NAV for", fund.name);
      return null;
    }
    const price = parseFloat(navMatch[1].replace(",", "."));

    // Parse daily change: <td data-label="1 pv"><span class="down">-1,26 %</span></td>
    const changeMatch = html.match(/data-label="1 pv"><span class="(?:up|down)">([-\d,]+)\s*%/);
    const dayChangePct = changeMatch ? parseFloat(changeMatch[1].replace(",", ".")) : 0;
    const previousClose = dayChangePct !== 0 ? price / (1 + dayChangePct / 100) : price;

    console.info("[ticker] Seligson", fund.name, "NAV:", price, "change:", dayChangePct + "%");

    // Fetch proxy chart data for sparklines
    let sparkline: SparkPoint[] = [];
    let sparklineMax: SparkPoint[] = [];
    const proxyTicker = fund.slug.includes("suomi") ? "^OMXH25" : "URTH";
    try {
      const [proxyDaily, proxyMax] = await Promise.all([
        fetchYahooChart(proxyTicker, "1y", "1d"),
        fetchYahooChart(proxyTicker, "max", "1mo"),
      ]);
      const scaleProxy = (points: { t: number; c: number }[]) => {
        if (points.length < 2) return [];
        const lastProxy = points[points.length - 1].c || 1;
        const scale = price / lastProxy;
        return points.map((p) => ({ t: p.t, c: Math.round(p.c * scale * 1000) / 1000 }));
      };
      if (proxyDaily) sparkline = scaleProxy(proxyDaily.points);
      if (proxyMax) sparklineMax = scaleProxy(proxyMax.points);
      console.debug("[ticker] Seligson proxy from", proxyTicker, "daily:", sparkline.length, "max:", sparklineMax.length);
    } catch (proxyErr) {
      console.warn("[ticker] Seligson proxy chart error:", proxyErr);
    }

    return {
      symbol: `SELIGSON:${fundKey.toUpperCase()}`,
      name: fund.name,
      price,
      previousClose: Math.round(previousClose * 1000) / 1000,
      currency: "EUR",
      dayChangePct,
      week52High: 0,
      week52Low: 0,
      sparkline,
      sparklineMax,
    };
  } catch (err) {
    console.error("[ticker] Seligson scrape error:", err);
    return null;
  }
}

export interface SparkPoint {
  t: number; // unix timestamp
  c: number; // close price
}

export interface TickerData {
  symbol: string;
  name: string;
  price: number;
  previousClose: number;
  currency: string;
  dayChangePct: number;
  week52High: number;
  week52Low: number;
  sparkline: SparkPoint[];
  sparklineMax: SparkPoint[];
}

async function fetchYahooChart(symbol: string, range: string, interval: string): Promise<{ meta: Record<string, unknown>; points: { t: number; c: number }[] } | null> {
  const res = await fetch(`${YAHOO_CHART_URL}/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`, {
    headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const result0 = data?.chart?.result?.[0];
  if (!result0?.meta) return null;
  const timestamps: number[] = result0.timestamp ?? [];
  const closes: (number | null)[] = result0.indicators?.quote?.[0]?.close ?? [];
  const points: { t: number; c: number }[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (closes[i] != null) points.push({ t: timestamps[i], c: closes[i] as number });
  }
  return { meta: result0.meta, points };
}

async function fetchTicker(symbol: string): Promise<TickerData | null> {
  console.info("[ticker] Fetching", symbol, "from Yahoo Finance");
  try {
    // Fetch 1y daily for short ranges + 5y weekly for MAX in parallel
    const [daily, longTerm] = await Promise.all([
      fetchYahooChart(symbol, "1y", "1d"),
      fetchYahooChart(symbol, "max", "1mo"),
    ]);

    if (!daily) {
      console.warn("[ticker] No data for", symbol);
      return null;
    }

    const { meta, points: sparkline } = daily;
    const sparklineMax = longTerm?.points ?? sparkline;
    const price = (meta.regularMarketPrice as number) ?? 0;

    // Daily change from second-to-last close
    const yesterdayClose = sparkline.length >= 2 ? sparkline[sparkline.length - 2].c : price;
    const dayChangePct = yesterdayClose > 0 ? ((price - yesterdayClose) / yesterdayClose) * 100 : 0;

    const tickerResult: TickerData = {
      symbol: (meta.symbol as string) || symbol,
      name: (meta.shortName as string) || (meta.longName as string) || symbol,
      price,
      previousClose: yesterdayClose,
      currency: (meta.currency as string) || "USD",
      dayChangePct: Math.round(dayChangePct * 100) / 100,
      week52High: (meta.fiftyTwoWeekHigh as number) ?? 0,
      week52Low: (meta.fiftyTwoWeekLow as number) ?? 0,
      sparkline,
      sparklineMax,
    };

    console.info("[ticker] Fetched", symbol, "price:", price, "change:", tickerResult.dayChangePct + "%", "1y:", sparkline.length, "pts, max:", sparklineMax.length, "pts");
    return tickerResult;
  } catch (err) {
    console.error("[ticker] Fetch error for", symbol, err);
    return null;
  }
}


// The symbols asked for, from cache when it is fresh enough and from the source when it is not.
export async function tickerData(symbols: string[]): Promise<Record<string, TickerData>> {
  const symbolList = symbols.map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (symbolList.length === 0) return {};

  const db = getDb();
  const result: Record<string, TickerData> = {};
  const toFetch: string[] = [];

  // Check cache first
  for (const sym of symbolList) {
    const cached = db.prepare("SELECT * FROM ticker_cache WHERE symbol = ?").get(sym) as {
      symbol: string; name: string; price: number; previous_close: number; currency: string;
      day_change_pct: number; week_52_high: number; week_52_low: number; sparkline_json: string; sparkline_max_json: string; updated_at: string;
    } | undefined;

    if (cached) {
      const age = Date.now() - new Date(cached.updated_at).getTime();
      if (age < CACHE_TTL_MS) {
        console.debug("[ticker] Cache hit for", sym, "age:", Math.round(age / 1000) + "s");
        result[sym] = {
          symbol: cached.symbol,
          name: cached.name,
          price: cached.price,
          previousClose: cached.previous_close,
          currency: cached.currency,
          dayChangePct: cached.day_change_pct,
          week52High: cached.week_52_high,
          week52Low: cached.week_52_low,
          sparkline: JSON.parse(cached.sparkline_json || "[]"),
          sparklineMax: JSON.parse(cached.sparkline_max_json || "[]"),
        };
        continue;
      }
    }
    toFetch.push(sym);
  }

  // Fetch missing/stale tickers
  if (toFetch.length > 0) {
    console.info("[ticker] Fetching", toFetch.length, "tickers:", toFetch.join(", "));
    const fetched = await Promise.all(toFetch.map((sym) => {
      if (sym.startsWith("SELIGSON:")) return fetchSeligson(sym.split(":")[1].toLowerCase());
      return fetchTicker(sym);
    }));

    const upsert = db.prepare(`
      INSERT INTO ticker_cache (symbol, name, price, previous_close, currency, day_change_pct, week_52_high, week_52_low, sparkline_json, sparkline_max_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(symbol) DO UPDATE SET name=excluded.name, price=excluded.price, previous_close=excluded.previous_close,
        currency=excluded.currency, day_change_pct=excluded.day_change_pct, week_52_high=excluded.week_52_high,
        week_52_low=excluded.week_52_low, sparkline_json=excluded.sparkline_json, sparkline_max_json=excluded.sparkline_max_json, updated_at=datetime('now')
    `);

    for (let i = 0; i < toFetch.length; i++) {
      const data = fetched[i];
      if (data) {
        result[toFetch[i]] = data;
        try {
          upsert.run(data.symbol, data.name, data.price, data.previousClose, data.currency, data.dayChangePct, data.week52High, data.week52Low, JSON.stringify(data.sparkline), JSON.stringify(data.sparklineMax));
        } catch (cacheErr) {
          console.warn("[ticker] Cache write failed for", toFetch[i], cacheErr);
        }
      }
    }
  }

  return result;
}
