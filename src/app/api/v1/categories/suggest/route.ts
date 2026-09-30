import { apiRoute } from "@/lib/api-v1";
import { getDb } from "@/lib/db";
import { suggestCategories, guessCategory } from "@/lib/category-suggest";

// GET /api/v1/categories/suggest?payee=&memo=&amount= (read) - the categories a picker should
// offer first for this entry: the best guess (payee and amount history, else AI), then the ones
// this payee is most often filed under. Same helpers as the web's add-expense dialog.
export const GET = apiRoute("read", async (request) => {
  const params = new URL(request.url).searchParams;
  const payee = (params.get("payee") || "").trim();
  const memo = (params.get("memo") || "").trim();
  const amount = parseFloat(params.get("amount") || "");
  const db = getDb();
  const guess = await guessCategory(db, payee, memo, amount);
  return { guess: guess.category, ranked: suggestCategories(db, payee, memo) };
});
