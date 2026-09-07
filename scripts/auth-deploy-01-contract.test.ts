import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("scripts/seed-deployment-users.ts", "utf8");
assert.match(source, /update users set password_hash/);
assert.match(source, /where id = \$\{existing\[0\]\.id\}/);
assert.match(source, /archived_at = null/);
assert.match(source, /status = 'active'/);
assert.match(source, /--verify/);
assert.match(source, /argon2\.verify/);
assert.match(source, /Missing required environment variable/);
assert.doesNotMatch(source, /123456|admin123|password\s*:\s*["'`]/i);
assert.match(source, /ALLOW_ALNOOR_USER_SEED/);
assert.match(source, /ALLOW_ALNOOR_REMOTE_SEED/);
assert.match(source, /Mode: DRY RUN/);
assert.match(source, /Mode: EXECUTE/);
for (const username of ["ahmed", "noaman", "nour", "abla", "wedad", "mohamed"]) assert.match(source, new RegExp(username));
assert.doesNotMatch(source, /delete\s+from\s+users/i);
console.log("AUTH-DEPLOY-01 contract: PASS");
