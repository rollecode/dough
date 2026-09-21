import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";

process.env.DOUGH_DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), "dough-test-")), "test.db");
process.env.SESSION_SECRET ??= "test-secret-at-least-32-characters-long";
