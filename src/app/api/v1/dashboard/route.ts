import { apiRoute } from "@/lib/api-v1";
import { dashboardFor } from "@/lib/dashboard-for";

// GET /api/v1/dashboard - everything the dashboard shows, in one call: the daily budget and why it
// is what it is, today's spending, the obligations ahead, the charts and the month's figures. The
// numbers are produced by lib/dashboard-model, the same module the web dashboard reads, so a phone
// and a browser looking at the same instance cannot disagree.
export const GET = apiRoute("read", (_request, identity) => dashboardFor(identity.userId));
