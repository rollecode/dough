import { apiRoute } from "@/lib/api-v1";
import { exportResponse } from "@/lib/account";

// GET /api/v1/account/export - the household's data as a SQLite file. Needs the write scope: the
// copy holds every member's sign-in, which a read-only key should not be able to take away.
export const GET = apiRoute("write", () => exportResponse());
