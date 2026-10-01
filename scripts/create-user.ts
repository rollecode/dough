import { readFileSync } from "fs";
import { getDb } from "../src/lib/db";
import bcrypt from "bcryptjs";

// Add a person to a database, creating the database and its schema when it is new. The details
// come in on stdin as JSON so a password never shows in the process list:
//
//   echo '{"email":"you@example.com","name":"You","locale":"en","password":"..."}' | \
//     DOUGH_DB_PATH=data/dough.db npx tsx scripts/create-user.ts
//
// A hosting service that has already hashed the password passes password_hash instead.

const input = JSON.parse(readFileSync(0, "utf8")) as {
  email?: string;
  name?: string;
  locale?: string;
  password?: string;
  password_hash?: string;
};

const email = input.email?.trim().toLowerCase();
const locale = input.locale === "fi" ? "fi" : "en";
if (!email || !(input.password || input.password_hash)) {
  console.error("email and password (or password_hash) are required");
  process.exit(1);
}

const db = getDb();
if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) {
  console.error("That email already has an account here");
  process.exit(1);
}

const hash = input.password_hash ?? bcrypt.hashSync(input.password!, 10);
const id = db.prepare("INSERT INTO users (email, password_hash, display_name, locale) VALUES (?, ?, ?, ?)")
  .run(email, hash, input.name ?? "", locale).lastInsertRowid;
console.info(JSON.stringify({ id: Number(id), email }));
