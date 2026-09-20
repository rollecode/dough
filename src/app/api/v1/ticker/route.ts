import { apiRoute } from "@/lib/api-v1";
import { tickerData } from "@/lib/ticker";

// GET /api/v1/ticker?symbols=AAPL,SELIGSON:brands - price, day change and the sparklines the
// investments page charts. The same module the web's own route uses, so both draw one curve.
export const GET = apiRoute("read", async (request) => {
  const symbols = new URL(request.url).searchParams.get("symbols") ?? "";
  const tickers = await tickerData(symbols.split(","));
  return { tickers, count: Object.keys(tickers).length };
});
