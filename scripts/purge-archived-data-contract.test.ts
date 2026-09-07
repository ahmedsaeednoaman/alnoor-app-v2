import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ARCHIVE_TABLE_ALLOWLIST, assertPreservedActiveIdsUnchanged } from "./purge-archived-data";

const source = readFileSync(join(process.cwd(), "scripts/purge-archived-data.ts"), "utf8");
if (!source.includes("--execute")) throw new Error("execute guard missing");
if (!source.includes("ALLOW_ALNOOR_ARCHIVED_PURGE") || !source.includes("ALLOW_ALNOOR_REMOTE_PURGE")) throw new Error("purge guards missing");
if (source.includes("TRUNCATE") || source.includes("DROP TABLE") || source.includes("DROP SCHEMA")) throw new Error("broad destructive SQL found");
if (/delete\s+from[^;]*(roles|permissions|role_permissions|doctors|hospitals|lithotripsy_sessions)/i.test(source)) throw new Error("protected delete found");
for (const table of ["users", "lithotripsy_sessions", "doctors", "hospitals"]) if (!ARCHIVE_TABLE_ALLOWLIST.includes(table as never)) throw new Error(`audit allowlist missing ${table}`);
if (ARCHIVE_TABLE_ALLOWLIST.includes("operations" as never)) throw new Error("operations incorrectly allowlisted");
if (!source.includes("REFERENCED_BY_ACTIVE") || !source.includes("BLOCKED_UNKNOWN") || !source.includes("METADATA_REFERENCE_ONLY")) throw new Error("dependency classification missing");
if (!source.includes("DEPENDENT_OF_PURGE_TARGET")) throw new Error("purge-tree classification missing");
if (!source.includes("information_schema") || !source.includes("foreignKeysTo")) throw new Error("FK inspection missing");
if (!source.includes("pricing") || !source.includes("work_form")) throw new Error("configuration safety coverage missing");
if (!source.includes("lithotripsy_pricing_profile_procedures")) throw new Error("pricing procedure child handling missing");
if (!source.includes("snapshotPreservedIds")) throw new Error("preserved stable-ID invariant missing");
if (!source.includes("PRODUCTION_USERS")) throw new Error("production user set invariant missing");
if (!source.includes("assertPricingGraph")) throw new Error("pricing graph invariant missing");
if (!source.includes("where user_id = any")) throw new Error("archived-user session cleanup missing");
if (!source.includes("archived_at is null") || !source.includes("ARCHIVE_TABLE_ALLOWLIST.includes(table")) throw new Error("preserved-active identity snapshot missing");
if (!source.includes("Archive-capable tables are allowed")) throw new Error("archive-capable invariant distinction missing");
if (source.includes("for (const table of PRESERVED_MASTER_TABLES) if (after.counts[table] !== baseline.counts[table])")) throw new Error("false total-count invariant remains");
for (const target of ["doctors", "hospitals", "procedures", "lithotripsy_pricing_profiles", "work_form_sections"]) if (!source.includes(target)) throw new Error(`preservation target missing: ${target}`);
if (!source.includes("RUNTIME_DELETE_TABLES")) throw new Error("runtime-zero invariant missing");
if (/delete\s+from\s+public\.users\s+where\s+archived_at/i.test(source)) throw new Error("generic archived user delete found");
if (source.includes("password_hash") || source.includes("session_token")) throw new Error("secret/token output risk found");
if (!source.includes("sql.begin") || !source.includes("INVARIANT FAILED")) throw new Error("transaction/invariant protection missing");
// Pure identity checks model the execution invariant: archived rows may
// disappear, but every preserved active identity must survive.
assertPreservedActiveIdsUnchanged({ doctors: ["active-doctor"], hospitals: ["active-hospital"], procedures: ["active-procedure"] }, { doctors: ["active-doctor"], hospitals: ["active-hospital"], procedures: ["active-procedure"] });
assert.throws(() => assertPreservedActiveIdsUnchanged({ doctors: ["active-doctor"] }, { doctors: [] }));
assertPreservedActiveIdsUnchanged({ lithotripsy_pricing_profiles: ["active-profile"], work_form_sections: ["active-section"] }, { lithotripsy_pricing_profiles: ["active-profile"], work_form_sections: ["active-section"] });
console.log("archived purge contract: PASS");
