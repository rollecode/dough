import { apiRoute } from "@/lib/api-v1";
import { exportResponse } from "@/lib/account";

// GET /api/v1/account/export - the household's data as a SQLite file, without its credentials: a
// connected app must not be able to take away the bank and AI keys or the members' password hashes.
export const GET = apiRoute("write", () => exportResponse("without-credentials"));
