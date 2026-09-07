import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEPLOYMENT_USERS, PRESERVED_MASTER_TABLES, RUNTIME_DELETE_TABLES, assertExecuteGuards, parseDatabaseTarget } from "./deployment-db-common";

const reset = readFileSync(join(process.cwd(), "scripts/reset-test-data.ts"), "utf8");
const seed = readFileSync(join(process.cwd(), "scripts/seed-deployment-users.ts"), "utf8");
const all = `${reset}\n${seed}`;

if (!all.includes("--execute")) throw new Error("execute guard missing");
if (!all.includes("ALLOW_ALNOOR_DB_RESET") || !all.includes("ALLOW_ALNOOR_REMOTE_RESET")) throw new Error("reset guards missing");
if (!all.includes("ALLOW_ALNOOR_USER_SEED") || !all.includes("ALLOW_ALNOOR_REMOTE_SEED")) throw new Error("seed guards missing");
if (all.includes("TRUNCATE") || all.includes("DROP TABLE") || all.includes("DROP SCHEMA")) throw new Error("forbidden broad mutation keyword found");
if (RUNTIME_DELETE_TABLES.includes("roles" as never) || PRESERVED_MASTER_TABLES.includes("users" as never)) throw new Error("classification overlap");
if (RUNTIME_DELETE_TABLES.indexOf("push_subscriptions") < 0 || RUNTIME_DELETE_TABLES.indexOf("push_dispatch_claims") < 0 || RUNTIME_DELETE_TABLES.indexOf("sessions") < 0) throw new Error("auth/push runtime tables missing");
if (DEPLOYMENT_USERS.map((u) => u.username).join(",") !== "ahmed,noaman,nour,abla,wedad,mohamed") throw new Error("deployment usernames changed");
if (!all.includes("argon2id")) throw new Error("Argon2id missing");
if (!PRESERVED_MASTER_TABLES.includes("lithotripsy_sessions")) throw new Error("lithotripsy_sessions is not preserved");
if (/delete\s+from[^;]*lithotripsy_sessions/i.test(reset)) throw new Error("lithotripsy_sessions deletion found");
if (!reset.includes("pricingSessionReferences")) throw new Error("pricing reference invariant missing");
if (!reset.includes("existingAhmed")) throw new Error("existing-user conflict preflight missing");
if (!reset.includes("assertPostResetInvariants")) throw new Error("post-reset invariants missing");
if (!readFileSync(join(process.cwd(), "scripts/deployment-db-inspect.ts"), "utf8").includes("lithotripsyRelation")) throw new Error("lithotripsy FK inspection missing");
if (!all.includes("creator") && !reset.includes("created_by_user_id")) throw new Error("creator reassignment missing");
if (all.includes("console.log(value.password") || all.includes("console.log(passwordHash")) throw new Error("secret logging found");
if (!all.includes("sql.begin")) throw new Error("transaction missing");
if (parseDatabaseTarget("postgres://u:p@localhost:5432/db").classification !== "LOCAL") throw new Error("local target classification failed");
if (parseDatabaseTarget("postgres://u:p@neon.example/db").classification !== "REMOTE") throw new Error("remote target classification failed");
let refused = false;
try { assertExecuteGuards(parseDatabaseTarget("postgres://u:p@localhost/db"), [], "YES_I_UNDERSTAND", "YES_I_UNDERSTAND_THIS_IS_REMOTE"); } catch { refused = true; }
if (!refused) throw new Error("--execute alone did not refuse");
console.log("deployment reset contract: PASS");
