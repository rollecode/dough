import { apiRoute } from "@/lib/api-v1";
import { payeeUsage, SUGGESTION_POOL } from "@/lib/payees";
import { suggestPayeeMerges } from "@/lib/ai/payee-merge";

// GET /api/v1/payees/merge-suggestions - payees that look like one merchant written several ways,
// as groups of { into, from }, proposed by the quick AI model. Nothing is merged by asking.
export const GET = apiRoute("read", async () => {
  const groups = await suggestPayeeMerges(payeeUsage(SUGGESTION_POOL));
  return { groups };
});
