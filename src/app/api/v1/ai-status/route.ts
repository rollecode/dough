import { apiRoute } from "@/lib/api-v1";
import { aiStatus } from "@/lib/ai/status";

// GET /api/v1/ai-status - each AI service, the provider it runs on, whether it works, and how much
// of the month's AI allowance is used (null when unlimited).
export const GET = apiRoute("read", () => aiStatus());
