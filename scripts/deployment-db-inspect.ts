import postgres from "postgres";
import {
  CONDITIONAL_TABLES,
  PRESERVED_MASTER_TABLES,
  RUNTIME_DELETE_TABLES,
  parseDatabaseTarget,
  quoteIdentifier,
} from "./deployment-db-common";

export async function inspectDatabase(sql: postgres.Sql) {
  const [identity] = await sql`select current_database() as database, current_user as user`;
  const allTables = [...RUNTIME_DELETE_TABLES, ...PRESERVED_MASTER_TABLES, ...CONDITIONAL_TABLES];
  const counts: Record<string, number | null> = {};
  const archived: Record<string, number> = {};
  for (const table of allTables) {
    const [exists] = await sql`
      select exists(
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = ${table}
      ) as present
    `;
    if (!exists.present) { counts[table] = null; continue; }
    const [count] = await sql.unsafe(`select count(*)::int as count from public.${quoteIdentifier(table)}`);
    counts[table] = Number(count.count);
    const [hasArchived] = await sql`
      select exists(
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = ${table} and column_name = 'archived_at'
      ) as present
    `;
    if (hasArchived.present) {
      const [row] = await sql.unsafe(`select count(*)::int as count from public.${quoteIdentifier(table)} where archived_at is not null`);
      archived[table] = Number(row.count);
    }
  }
  const users = await sql`
    select u.id, u.username, u.display_name, u.status, u.archived_at, r.code as role_code
    from users u join roles r on r.id = u.base_role_id
    order by u.username
  `;
  const lithotripsyRelation = await sql`
    select kcu.column_name, c.is_nullable, rc.delete_rule
    from information_schema.key_column_usage kcu
    join information_schema.referential_constraints rc
      on rc.constraint_name = kcu.constraint_name and rc.constraint_schema = kcu.constraint_schema
    join information_schema.constraint_column_usage ccu
      on ccu.constraint_name = rc.unique_constraint_name and ccu.constraint_schema = rc.unique_constraint_schema
    join information_schema.columns c
      on c.table_schema = kcu.table_schema and c.table_name = kcu.table_name and c.column_name = kcu.column_name
    where kcu.table_schema = 'public' and kcu.table_name = 'operations'
      and kcu.column_name = 'lithotripsy_session_id'
      and ccu.table_name = 'lithotripsy_sessions'
  `;
  const references = await sql`
    select tc.table_name as table_name, kcu.column_name as column_name
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
    join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
    where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public' and ccu.table_name = 'users' and ccu.column_name = 'id'
    order by tc.table_name, kcu.column_name
  `;
  const creatorReferences = [] as Array<{ table: string; column: string; rows: number }>;
  for (const reference of references) {
    const table = String(reference.table_name);
    if (!PRESERVED_MASTER_TABLES.includes(table as (typeof PRESERVED_MASTER_TABLES)[number])) continue;
    const column = String(reference.column_name);
    const [row] = await sql.unsafe(`select count(*)::int as count from public.${quoteIdentifier(table)} where ${quoteIdentifier(column)} is not null`);
    creatorReferences.push({ table, column, rows: Number(row.count) });
  }
  let lithotripsy = { total: counts.lithotripsy_sessions ?? null, linkedToOperations: null as number | null, referencedByPricing: null as number | null };
  let pricingSessionReferences: Array<{ id: string; sessionId: string }> = [];
  if (counts.lithotripsy_sessions !== null) {
    const [linked] = await sql`select count(*)::int as count from lithotripsy_sessions s where exists (select 1 from operations o where o.lithotripsy_session_id = s.id)`;
    pricingSessionReferences = await sql`select id, session_id as "sessionId" from lithotripsy_pricing_profiles where session_id is not null order by id` as Array<{ id: string; sessionId: string }>;
    const pricing = pricingSessionReferences.length;
    lithotripsy = { total: counts.lithotripsy_sessions, linkedToOperations: Number(linked.count), referencedByPricing: pricing };
  }
  return { identity, counts, archived, creatorReferences, lithotripsy, pricingSessionReferences, users, lithotripsyRelation };
}

async function main() {
  const target = parseDatabaseTarget();
  console.log("Database target:");
  console.log(`Host: ${target.host}`);
  console.log(`Port: ${target.port}`);
  console.log(`Database: ${target.database}`);
  console.log(`User: ${target.user}`);
  console.log(`Target classification: ${target.classification}`);
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const report = await inspectDatabase(sql);
    console.log(JSON.stringify(report, null, 2));
  } finally { await sql.end({ timeout: 2 }); }
}

if (import.meta.url === `file://${process.argv[1]}`) void main().catch((error) => { console.error(error instanceof Error ? error.message : "Inspection failed"); process.exitCode = 1; });
