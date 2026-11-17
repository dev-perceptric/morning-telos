// Decrypts a Morning Telos backup so it can be restored.
// Usage: APP_SECRET=... node tools/decrypt-backup.js mt-....dump.enc > restore.dump
//        pg_restore --clean --no-owner -d "$DATABASE_URL" restore.dump
import fs from "node:fs";
import { decryptBackup } from "../lib/backup.js";
const file = process.argv[2];
if (!file || !process.env.APP_SECRET) { console.error("Usage: APP_SECRET=... node tools/decrypt-backup.js <file.dump.enc> > restore.dump"); process.exit(1); }
process.stdout.write(decryptBackup(fs.readFileSync(file)));
