import postgres from "postgres";
import {
  PRESERVED_MASTER_TABLES,
  RUNTIME_DELETE_TABLES,
  parseDatabaseTarget,
  quoteIdentifier,
} from "./deployment-db-common";
import { inspectDatabase } from "./deployment-db-inspect";

export const ARCHIVE_TABLE_ALLOWLIST = [
  "users", "doctors", "contract_entities", "hospitals", "procedures", "equipment",
  "consumables", "stents", "anesthesiologists", "anesthesia_types", "technicians",
  "financial_item_catalog", "work_form_sections", "work_form_fields", "lithotripsy_sessions",
  "lithotripsy_pricing_profiles", "lithotripsy_pricing_profile_lines", "service_pricing_profiles",
  "service_pricing_items",
] as const;

const ARCHIVE_DELETE_ORDER = [
  "work_form_fields", "work_form_sections", "lithotripsy_pricing_profile_procedures",
  "lithotripsy_pricing_profile_lines", "service_pricing_items", "lithotripsy_pricing_profiles",
  "service_pricing_profiles", "lithotripsy_sessions", "financial_item_catalog", "technicians",
  "anesthesia_types", "anesthesiologists", "stents", "consumables", "equipment", "procedures",
  "hospitals", "contract_entities", "doctors", "users",
] as const;

export const PRODUCTION_USERS = [
  ["abla", "employee"], ["ahmed", "owner"], ["mohamed", "employee"],
  ["noaman", "owner"], ["nour", "accountant"], ["wedad", "employee"],
] as const;

type Classification = "SAFE_DELETE" | "REFERENCED_BY_ARCHIVED" | "REFERENCED_BY_ACTIVE" | "METADATA_REFERENCE_ONLY" | "DEPENDENT_OF_PURGE_TARGET" | "BLOCKED_UNKNOWN";
type Ref = { table: string; rowCount: number; column: string; classification: Classification };
export type ArchiveRow = { table: string; id: string; label: string | null; archivedAt: string | null; classification: Classification; references: Ref[] };
const metadataColumns = new Set(["created_by_user_id", "updated_by_user_id", "created_by", "updated_by"]);
const dependentUserTables = new Set(["sessions", "push_subscriptions", "user_permission_overrides"]);
const treeChildren = new Set(["work_form_fields", "lithotripsy_pricing_profile_procedures", "lithotripsy_pricing_profile_lines", "service_pricing_items"]);

async function archiveTables(sql: postgres.Sql) {
  const rows = await sql`select table_name from information_schema.columns where table_schema='public' and column_name='archived_at' order by table_name`;
  return rows.map((r) => String(r.table_name));
}
async function tableColumns(sql: postgres.Sql, table: string) {
  const rows = await sql`select column_name from information_schema.columns where table_schema='public' and table_name=${table} order by ordinal_position`;
  return rows.map((r) => String(r.column_name));
}
async function foreignKeysTo(sql: postgres.Sql, table: string) {
  return sql`select tc.table_name as referencing_table,kcu.column_name as referencing_column from information_schema.table_constraints tc join information_schema.key_column_usage kcu on kcu.constraint_name=tc.constraint_name and kcu.table_schema=tc.table_schema join information_schema.constraint_column_usage ccu on ccu.constraint_name=tc.constraint_name and ccu.table_schema=tc.table_schema where tc.table_schema='public' and tc.constraint_type='FOREIGN KEY' and ccu.table_name=${table} and ccu.column_name='id'`;
}
function labelFor(row: Record<string, unknown>) {
  for (const key of ["name", "label", "title", "display_name", "username", "stable_key", "code", "normalized_name"]) if (row[key] !== null && row[key] !== undefined) return String(row[key]);
  return null;
}
function rank(c: Classification) { return ({ SAFE_DELETE: 0, DEPENDENT_OF_PURGE_TARGET: 1, REFERENCED_BY_ARCHIVED: 2, METADATA_REFERENCE_ONLY: 3, BLOCKED_UNKNOWN: 4, REFERENCED_BY_ACTIVE: 5 } as Record<Classification, number>)[c]; }
function summarize(refs: Ref[]): Classification { return refs.reduce<Classification>((best, ref) => rank(ref.classification) > rank(best) ? ref.classification : best, "SAFE_DELETE"); }

async function classifyRow(sql: postgres.Sql, table: string, row: Record<string, unknown>, fks: Array<{ referencing_table: string; referencing_column: string }>, archiveCapable: Set<string>): Promise<ArchiveRow> {
  const id = row.id == null ? "" : String(row.id);
  if (!id) return { table, id, label: labelFor(row), archivedAt: row.archived_at == null ? null : String(row.archived_at), classification: "BLOCKED_UNKNOWN", references: [] };
  const refs: Ref[] = [];
  for (const fk of fks) {
    const refTable = String(fk.referencing_table), column = String(fk.referencing_column);
    const [total] = await sql.unsafe(`select count(*)::int as count from public.${quoteIdentifier(refTable)} where ${quoteIdentifier(column)}=$1`, [id]);
    const count = Number(total.count); if (!count) continue;
    let classification: Classification;
    if (table === "users" && dependentUserTables.has(refTable)) classification = "DEPENDENT_OF_PURGE_TARGET";
    else if (table === "users" && metadataColumns.has(column)) classification = "METADATA_REFERENCE_ONLY";
    else if (archiveCapable.has(refTable)) {
      const [active] = await sql.unsafe(`select count(*)::int as count from public.${quoteIdentifier(refTable)} where ${quoteIdentifier(column)}=$1 and archived_at is null`, [id]);
      classification = Number(active.count) ? "REFERENCED_BY_ACTIVE" : "REFERENCED_BY_ARCHIVED";
    } else classification = "REFERENCED_BY_ACTIVE";
    refs.push({ table: refTable, rowCount: count, column, classification });
  }
  return { table, id, label: labelFor(row), archivedAt: row.archived_at == null ? null : String(row.archived_at), classification: summarize(refs), references: refs };
}

async function normalizePurgeTrees(sql: postgres.Sql, rows: ArchiveRow[]) {
  const archived = new Map<string, Set<string>>();
  for (const row of rows) { if (!archived.has(row.table)) archived.set(row.table, new Set()); archived.get(row.table)!.add(row.id); }
  for (const row of rows) {
    if (treeChildren.has(row.table) && row.references.some((r) => {
      if (row.table === "work_form_fields") return r.table === "work_form_sections" && r.classification !== "REFERENCED_BY_ACTIVE";
      if (row.table === "service_pricing_items") return r.table === "service_pricing_profiles" && r.classification !== "REFERENCED_BY_ACTIVE";
      return (r.table === "lithotripsy_pricing_profiles" && r.classification !== "REFERENCED_BY_ACTIVE");
    })) row.classification = "DEPENDENT_OF_PURGE_TARGET";
    if ([...treeChildren].includes(row.table)) continue;
    if (row.table === "lithotripsy_pricing_profiles" || row.table === "service_pricing_profiles" || row.table === "work_form_sections") {
      const children = row.references.filter((r) => treeChildren.has(r.table));
      // The parent is itself archived, so every direct child link is inside
      // this approved purge tree even when the link table has no archived_at.
      for (const ref of children) ref.classification = "DEPENDENT_OF_PURGE_TARGET";
      row.classification = summarize(row.references);
    }
  }
  // A catalog/procedure referenced only by links under archived profiles belongs to that purge tree.
  for (const row of rows.filter((r) => r.table === "procedures" || r.table === "lithotripsy_pricing_definitions")) {
    const links = row.references.filter((r) => r.table === "lithotripsy_pricing_profile_procedures" || r.table === "lithotripsy_pricing_profile_lines");
    if (links.length) {
      const query = row.table === "procedures"
        ? `select count(*)::int as total, count(*) filter (where p.archived_at is null)::int as active from lithotripsy_pricing_profile_procedures x join lithotripsy_pricing_profiles p on p.id=x.profile_id where x.procedure_id=$1`
        : `select count(*)::int as total, count(*) filter (where p.archived_at is null)::int as active from lithotripsy_pricing_profile_lines x join lithotripsy_pricing_profiles p on p.id=x.profile_id where x.pricing_definition_id=$1`;
      const [usage] = await sql.unsafe(query, [row.id]);
      if (Number(usage.total) > 0 && Number(usage.active) === 0) row.classification = "DEPENDENT_OF_PURGE_TARGET";
    }
  }
  void archived;
}

export async function auditArchivedData(sql: postgres.Sql) {
  const tables = (await archiveTables(sql)).filter((t) => ARCHIVE_TABLE_ALLOWLIST.includes(t as never));
  const archiveCapable = new Set(tables), rows: ArchiveRow[] = [], activeCounts: Record<string, number> = {}, activeIds: Record<string, string[]> = {};
  for (const table of tables) {
    const columns = await tableColumns(sql, table);
    const selected = ["id", "archived_at", ...["name", "label", "title", "display_name", "username", "stable_key", "code", "normalized_name"].filter((c) => columns.includes(c))];
    const result = await sql.unsafe(`select ${selected.map(quoteIdentifier).join(",")} from public.${quoteIdentifier(table)} where archived_at is not null order by archived_at,id`);
    const [active] = await sql.unsafe(`select count(*)::int as count from public.${quoteIdentifier(table)} where archived_at is null`); activeCounts[table] = Number(active.count);
    const ids = await sql.unsafe(`select id from public.${quoteIdentifier(table)} where archived_at is null order by id`); activeIds[table] = ids.map((r) => String(r.id));
    const fks = await foreignKeysTo(sql, table) as unknown as Array<{ referencing_table: string; referencing_column: string }>;
    for (const row of result as Array<Record<string, unknown>>) rows.push(await classifyRow(sql, table, row, fks, archiveCapable));
  }
  await normalizePurgeTrees(sql, rows);
  const [owner] = await sql`select count(*)::int as count from users u join roles r on r.id=u.base_role_id where u.status='active' and u.archived_at is null and r.code='owner'`;
  const users = await sql`select u.id,u.username,u.display_name,u.status,u.archived_at,r.code as role_code from users u join roles r on r.id=u.base_role_id order by u.archived_at nulls first,u.username`;
  return { tables, rows, activeCounts, activeIds, activeOwners: Number(owner.count), users };
}

export function blockers(report: Awaited<ReturnType<typeof auditArchivedData>>) { return report.rows.filter((r) => r.classification === "REFERENCED_BY_ACTIVE" || r.classification === "BLOCKED_UNKNOWN"); }
function assertProductionUsers(users: Array<{ username: string; role_code: string; archived_at: unknown; status: string }>) {
  const actual = users.filter((u) => !u.archived_at && u.status === "active").map((u) => `${u.username}:${u.role_code}`).sort();
  const expected = PRODUCTION_USERS.map(([u, r]) => `${u}:${r}`).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`BLOCKER: active production users must be exactly ${expected.join(",")}`);
}
async function assertPricingGraph(sql: postgres.Sql) {
  const checks = [
    `select count(*)::int as count from lithotripsy_pricing_profile_lines l left join lithotripsy_pricing_profiles p on p.id=l.profile_id where p.id is null`,
    `select count(*)::int as count from lithotripsy_pricing_profile_procedures x left join lithotripsy_pricing_profiles p on p.id=x.profile_id left join procedures q on q.id=x.procedure_id where p.id is null or q.id is null`,
    `select count(*)::int as count from service_pricing_items i left join service_pricing_profiles p on p.id=i.profile_id where p.id is null`,
    `select count(*)::int as count from lithotripsy_pricing_profiles p left join lithotripsy_sessions s on s.id=p.session_id where p.session_id is not null and s.id is null`,
  ];
  for (const query of checks) { const [row] = await sql.unsafe(query); if (Number(row.count)) throw new Error("INVARIANT FAILED: pricing graph contains dangling references"); }
}
async function snapshotPreservedIds(sql: postgres.Sql) {
  const snapshot: Record<string, string[]> = {};
  for (const table of PRESERVED_MASTER_TABLES) {
    const keys = await sql`select kcu.column_name from information_schema.table_constraints tc join information_schema.key_column_usage kcu on kcu.constraint_name=tc.constraint_name and kcu.table_schema=tc.table_schema where tc.table_schema='public' and tc.table_name=${table} and tc.constraint_type='PRIMARY KEY' order by kcu.ordinal_position`;
    if (!keys.length) continue;
    const columns = keys.map((k) => String(k.column_name));
    const archivePredicate = ARCHIVE_TABLE_ALLOWLIST.includes(table as never) ? " where archived_at is null" : "";
    const rows = await sql.unsafe(`select ${columns.map(quoteIdentifier).join(",")} from public.${quoteIdentifier(table)}${archivePredicate} order by ${columns.map(quoteIdentifier).join(",")}`);
    snapshot[table] = rows.map((row) => columns.map((column) => String(row[column])).join(":"));
  }
  return snapshot;
}
export function assertPreservedActiveIdsUnchanged(before: Record<string, string[]>, after: Record<string, string[]>) {
  for (const [table, ids] of Object.entries(before)) {
    const afterSet = new Set(after[table] ?? []);
    for (const id of ids) if (!afterSet.has(id)) throw new Error(`INVARIANT FAILED: preserved active ID changed: ${table}:${id}`);
  }
}
async function executeArchivedPurge(sql: postgres.Sql, before: Awaited<ReturnType<typeof auditArchivedData>>, baseline: Awaited<ReturnType<typeof inspectDatabase>>, baselineIds?: Record<string, string[]>) {
  return sql.begin(async (tx) => {
    assertProductionUsers(before.users as never);
    const owner = before.users.find((u) => u.username === "ahmed" && u.role_code === "owner" && u.status === "active" && !u.archived_at);
    if (!owner) throw new Error("BLOCKER: ahmed active owner is required");
    if (blockers(before).length) throw new Error("BLOCKED: active or unknown archived dependencies remain");
    const targetIds = new Map<string, string[]>();
    for (const row of before.rows) if (["SAFE_DELETE", "REFERENCED_BY_ARCHIVED", "DEPENDENT_OF_PURGE_TARGET", "METADATA_REFERENCE_ONLY"].includes(row.classification)) { if (!targetIds.has(row.table)) targetIds.set(row.table, []); targetIds.get(row.table)!.push(row.id); }
    const users = targetIds.get("users") ?? [];
    if (users.length) for (const table of ["sessions", "push_subscriptions", "user_permission_overrides"]) await tx.unsafe(`delete from public.${quoteIdentifier(table)} where user_id = any($1::uuid[])`, [users]);
    const sectionIds = targetIds.get("work_form_sections") ?? [];
    if (sectionIds.length) await tx.unsafe(`delete from public.work_form_fields where section_id = any($1::uuid[])`, [sectionIds]);
    const profileIds = targetIds.get("lithotripsy_pricing_profiles") ?? [];
    if (profileIds.length) {
      await tx.unsafe(`delete from public.lithotripsy_pricing_profile_procedures where profile_id = any($1::uuid[])`, [profileIds]);
      await tx.unsafe(`delete from public.lithotripsy_pricing_profile_lines where profile_id = any($1::uuid[])`, [profileIds]);
    }
    const serviceProfileIds = targetIds.get("service_pricing_profiles") ?? [];
    if (serviceProfileIds.length) await tx.unsafe(`delete from public.service_pricing_items where profile_id = any($1::uuid[])`, [serviceProfileIds]);
    for (const row of before.rows.filter((r) => r.table === "users" && r.classification === "METADATA_REFERENCE_ONLY")) for (const ref of row.references.filter((r) => r.classification === "METADATA_REFERENCE_ONLY" && PRESERVED_MASTER_TABLES.includes(r.table as never))) {
      const activeOnly = ARCHIVE_TABLE_ALLOWLIST.includes(ref.table as never) ? " and archived_at is null" : "";
      await tx.unsafe(`update public.${quoteIdentifier(ref.table)} set ${quoteIdentifier(ref.column)}=$1 where ${quoteIdentifier(ref.column)}=$2${activeOnly}`, [owner.id, row.id]);
    }
    for (const table of ARCHIVE_DELETE_ORDER) { const ids = targetIds.get(table); if (!ids?.length) continue; await tx.unsafe(`delete from public.${quoteIdentifier(table)} where id = any($1::uuid[])`, [ids]); }
    const after = await inspectDatabase(tx as unknown as postgres.Sql), auditAfter = await auditArchivedData(tx as unknown as postgres.Sql);
    assertProductionUsers(after.users as never); if (after.users.length !== PRODUCTION_USERS.length || after.users.some((u) => u.archived_at)) throw new Error("INVARIANT FAILED: final users are not exactly six active production users"); if (auditAfter.rows.length) throw new Error("INVARIANT FAILED: archived rows remain");
    for (const table of RUNTIME_DELETE_TABLES.filter((t) => t !== "users" && t !== "sessions" && t !== "push_subscriptions" && t !== "user_permission_overrides")) if (after.counts[table] && after.counts[table] > 0) throw new Error(`INVARIANT FAILED: runtime table not empty: ${table}`);
    // Archive-capable tables are allowed to lose explicitly targeted archived
    // rows. Their preserved active identities are checked above instead.
    for (const table of PRESERVED_MASTER_TABLES) if (!ARCHIVE_TABLE_ALLOWLIST.includes(table as never) && after.counts[table] !== baseline.counts[table]) throw new Error(`INVARIANT FAILED: preserved table changed: ${table}`);
    if (baselineIds) assertPreservedActiveIdsUnchanged(baselineIds, await snapshotPreservedIds(tx as unknown as postgres.Sql));
    await assertPricingGraph(tx as unknown as postgres.Sql);
  });
}

async function main() {
  const argv = process.argv.slice(2), target = parseDatabaseTarget();
  console.log(`Database target: ${target.classification} ${target.host}:${target.port}/${target.database} as ${target.user}`);
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const report = await auditArchivedData(sql), baseline = await inspectDatabase(sql), baselineIds = await snapshotPreservedIds(sql);
    console.log(`Archive-capable tables: ${report.tables.join(", ")}`); console.log(`Active owners: ${report.activeOwners}`);
    console.log("ARCHIVED COUNTS:"); for (const table of report.tables) console.log(`${table}: ${report.rows.filter((r) => r.table === table).length}`);
    console.log("ACTIVE USERS:"); for (const u of report.users.filter((x) => !x.archived_at)) console.log(`${u.username} | ${u.display_name} | ${u.role_code} | ${u.status}`);
    console.log("ARCHIVED USERS:"); for (const u of report.users.filter((x) => Boolean(x.archived_at))) console.log(`${u.username} | ${u.display_name} | ${u.role_code} | ${u.status} | archived_at=${u.archived_at}`);
    for (const row of report.rows) { console.log(`${row.table} | ${row.id} | ${row.label ?? ""} | ${row.archivedAt ?? ""} | ${row.classification}`); for (const ref of row.references) console.log(`  ref ${ref.table}.${ref.column} rows=${ref.rowCount} classification=${ref.classification}`); }
    console.log(`SAFE_DELETE: ${report.rows.filter((r) => r.classification === "SAFE_DELETE").length}`); console.log(`DEPENDENT_OF_PURGE_TARGET: ${report.rows.filter((r) => r.classification === "DEPENDENT_OF_PURGE_TARGET").length}`); console.log(`REFERENCED_BY_ARCHIVED: ${report.rows.filter((r) => r.classification === "REFERENCED_BY_ARCHIVED").length}`); console.log(`REFERENCED_BY_ACTIVE: ${report.rows.filter((r) => r.classification === "REFERENCED_BY_ACTIVE").length}`); console.log(`BLOCKED_UNKNOWN: ${report.rows.filter((r) => r.classification === "BLOCKED_UNKNOWN").length}`);
    if (!argv.includes("--execute")) { console.log("No mutation requested; dry-run complete."); return; }
    if (process.env.ALLOW_ALNOOR_ARCHIVED_PURGE !== "YES_I_UNDERSTAND") throw new Error("REFUSED: ALLOW_ALNOOR_ARCHIVED_PURGE guard is missing");
    if (process.env.EXPECTED_DATABASE_NAME && process.env.EXPECTED_DATABASE_NAME !== target.database) throw new Error("REFUSED: EXPECTED_DATABASE_NAME does not match the target");
    if (target.classification === "REMOTE" && process.env.ALLOW_ALNOOR_REMOTE_PURGE !== "YES_I_UNDERSTAND_THIS_IS_REMOTE") throw new Error("REFUSED: remote archived purge guard is missing");
    await executeArchivedPurge(sql, report, baseline, baselineIds); console.log("Archived purge completed.");
  } finally { await sql.end({ timeout: 2 }); }
}
if (import.meta.url === `file://${process.argv[1]}`) void main().catch((e) => { console.error(e instanceof Error ? e.message : "Archived purge failed"); process.exitCode = 1; });
export { executeArchivedPurge };
