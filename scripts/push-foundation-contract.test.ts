import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import { pushSubscriptions, pushDispatchClaims } from "../src/db/schema";

const subscriptions = getTableConfig(pushSubscriptions);
const claims = getTableConfig(pushDispatchClaims);
assert.equal(subscriptions.name, "push_subscriptions");
assert.equal(claims.name, "push_dispatch_claims");
assert.deepEqual(subscriptions.columns.map(column => column.name), ["id", "user_id", "session_id", "endpoint", "p256dh", "auth", "user_agent", "created_at", "updated_at"]);
assert.deepEqual(claims.columns.map(column => column.name), ["id", "operation_id", "event_type", "created_at"]);
for (const config of [subscriptions, claims]) {
  for (const column of config.columns) {
    assert.equal(column.notNull, column.name !== "user_agent");
    assert.equal(column.primary, column.name === "id");
    assert.equal(column.getSQLType(), column.name === "id" || column.name.endsWith("_id") ? "uuid" : column.name.endsWith("_at") ? "timestamp with time zone" : "text");
    if (column.name === "id" || column.name.endsWith("_at")) assert.ok(column.hasDefault);
  }
}
function foreignKeys(config: typeof subscriptions) {
  return config.foreignKeys.map(fk => {
    const ref = fk.reference();
    return { columns: ref.columns.map(c => c.name), table: getTableConfig(ref.foreignTable).name, targets: ref.foreignColumns.map(c => c.name), onDelete: fk.onDelete };
  });
}
assert.deepEqual(foreignKeys(subscriptions), [
  { columns: ["user_id"], table: "users", targets: ["id"], onDelete: "cascade" },
  { columns: ["session_id"], table: "sessions", targets: ["id"], onDelete: "cascade" },
]);
assert.deepEqual(foreignKeys(claims), [{ columns: ["operation_id"], table: "operations", targets: ["id"], onDelete: "cascade" }]);
function indexes(config: typeof subscriptions) {
  return config.indexes.map(({ config: index }) => ({ name: index.name, unique: index.unique, columns: index.columns.map(c => "name" in c ? c.name : null) }));
}
assert.deepEqual(indexes(subscriptions), [
  { name: "push_subscriptions_endpoint_unique", unique: true, columns: ["endpoint"] },
  { name: "push_subscriptions_user_id_idx", unique: false, columns: ["user_id"] },
  { name: "push_subscriptions_session_id_idx", unique: false, columns: ["session_id"] },
]);
assert.deepEqual(indexes(claims), [{ name: "push_dispatch_claims_operation_event_unique", unique: true, columns: ["operation_id", "event_type"] }]);

const sql = readFileSync("drizzle/0035_push_foundation.sql", "utf8");
const statements = sql.split("--> statement-breakpoint").map(s => s.trim()).filter(Boolean);
assert.equal(statements.length, 9);
for (const statement of statements) assert.match(statement, /^(CREATE TABLE "push_(subscriptions|dispatch_claims)"|ALTER TABLE "push_(subscriptions|dispatch_claims)" ADD CONSTRAINT|CREATE (UNIQUE )?INDEX "push_)/, "only additive push DDL is permitted");
assert.doesNotMatch(sql.replace(/ON DELETE cascade ON UPDATE no action/gi, ""), /\b(DROP|TRUNCATE|DELETE|UPDATE|INSERT|RENAME)\b/i);
for (const name of ["push_subscriptions", "push_dispatch_claims"]) assert.match(sql, new RegExp(`CREATE TABLE "${name}"`));
for (const config of [subscriptions, claims]) {
  for (const fk of config.foreignKeys) {
    const ref = fk.reference();
    assert.ok(sql.includes(`FOREIGN KEY ("${ref.columns[0].name}") REFERENCES "public"."${getTableConfig(ref.foreignTable).name}"("id") ON DELETE cascade`));
  }
  for (const { config: index } of config.indexes) {
    const columns = index.columns.map(c => "name" in c ? `"${c.name}"` : "").join(",");
    assert.ok(sql.includes(`CREATE ${index.unique ? "UNIQUE " : ""}INDEX "${index.name}" ON "${config.name}" USING btree (${columns})`));
  }
}
assert.equal((sql.match(/DEFAULT gen_random_uuid\(\)/g) || []).length, 2);
assert.equal((sql.match(/DEFAULT now\(\)/g) || []).length, 3);
assert.doesNotMatch(sql, /role_code|permission_snapshot|sent_at|delivered_at|failed_at|retry_count|provider_response|CREATE TYPE/);

const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const history = [...readdirSync("drizzle").filter(f => /^\d{4}_.*\.sql$/.test(f) && Number(f.slice(0,4)) <= 34).map(f => `drizzle/${f}`), ...readdirSync("drizzle/meta").filter(f => /^\d{4}_snapshot\.json$/.test(f) && Number(f.slice(0,4)) <= 34).map(f => `drizzle/meta/${f}`)].sort();
assert.equal(hash(history.map(path => `${path}:${hash(readFileSync(path))}`).join("\n")), "08e7815f38e2a3db60dad3bdb952ad60532ed8213b07ce87ef44611bc028456c", "historical SQL and snapshots remain byte-identical");
for (const [path, expected] of Object.entries({"package.json": "8cf0f7785d10805f3d4f525369aa2376901744e6abd023b9e192ea47a0a2edf6", "package-lock.json": "a99a02f3b4656d3f71819524044fadece5980d3dd9586cdab4b5373dc17fd0cf"})) assert.equal(hash(readFileSync(path)), expected, "package manifests unchanged");
const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
const head = journal.entries.findIndex((entry: { tag: string }) => entry.tag === "0035_push_foundation");
assert.ok(head > 0);
assert.equal(journal.entries[head].idx, 35);
assert.equal(hash(JSON.stringify(journal.entries.slice(0, head))), "5eaced464f592ed27a6be9276aba1c5e8153bc65e6d0303f96999f685fab265b", "historical journal entries unchanged");
const previous = JSON.parse(readFileSync("drizzle/meta/0034_snapshot.json", "utf8"));
const snapshot = JSON.parse(readFileSync("drizzle/meta/0035_snapshot.json", "utf8"));
assert.equal(snapshot.prevId, previous.id);
for (const [name, table] of Object.entries(previous.tables)) assert.deepEqual(snapshot.tables[name], table);
assert.deepEqual(Object.keys(snapshot.tables).filter(name => !(name in previous.tables)).sort(), ["public.push_dispatch_claims", "public.push_subscriptions"]);
console.log("Push foundation contract: PASS — schema and migration only; no database connection");
