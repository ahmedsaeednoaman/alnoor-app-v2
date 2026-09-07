import { postgresClient } from "@/db/client";
import { OperationDomainError } from "@/lib/operations/api";

type Executor = Pick<typeof postgresClient, "unsafe">;
type Row = Record<string, unknown>;
export type LithotripsySession = { id: string; sessionNumber: number; name: string; sortOrder: number; active: boolean; archivedAt: string | null };
const dto = (row: Row): LithotripsySession => ({ id: String(row.id), sessionNumber: Number(row.session_number), name: String(row.name), sortOrder: Number(row.sort_order), active: Boolean(row.active), archivedAt: row.archived_at == null ? null : new Date(String(row.archived_at)).toISOString() });

export async function listLithotripsySessions(options: { includeArchived?: boolean } = {}, db: Executor = postgresClient) {
  const rows = await db.unsafe<Row[]>(`select id,session_number,name,sort_order,active,archived_at from lithotripsy_sessions ${options.includeArchived ? "" : "where active=true and archived_at is null"} order by sort_order,session_number`);
  return rows.map(dto);
}
export async function requireLithotripsySession(sessionNumber: number, db: Executor = postgresClient) {
  const [row] = await db.unsafe<Row[]>("select id,session_number,name,sort_order,active,archived_at from lithotripsy_sessions where session_number=$1 and active=true and archived_at is null", [sessionNumber]);
  if (!row) throw new OperationDomainError(400, "LITHO_SESSION_INVALID", "جلسة التفتيت المختارة غير متاحة.");
  return dto(row);
}
export async function requireLithotripsySessionById(id: string, db: Executor = postgresClient) {
  const [row] = await db.unsafe<Row[]>("select id,session_number,name,sort_order,active,archived_at from lithotripsy_sessions where id=$1::uuid and active=true and archived_at is null", [id]);
  if (!row) throw new OperationDomainError(400, "LITHO_SESSION_INVALID", "جلسة التفتيت المختارة غير متاحة.");
  return dto(row);
}
export async function createLithotripsySession(nameValue: string, userId: string) {
  const name = nameValue.trim().replace(/\s+/gu, " ");
  if (name.length < 2) throw new OperationDomainError(400, "LITHO_SESSION_NAME_REQUIRED", "اسم الجلسة مطلوب.");
  return postgresClient.begin(async (tx) => {
    const [row] = await tx.unsafe<Row[]>(`insert into lithotripsy_sessions(session_number,name,sort_order,created_by_user_id,updated_by_user_id)
      values((select coalesce(max(session_number),0)+1 from lithotripsy_sessions),$1,(select coalesce(max(sort_order),-1)+1 from lithotripsy_sessions),$2::uuid,$2::uuid) returning *`, [name, userId]);
    return dto(row);
  });
}
export async function setLithotripsySessionState(id: string, action: "archive" | "restore", userId: string) {
  return postgresClient.begin(async (tx) => {
    const [current] = await tx.unsafe<Row[]>("select * from lithotripsy_sessions where id=$1::uuid for update", [id]);
    if (!current) throw new OperationDomainError(404, "LITHO_SESSION_NOT_FOUND", "الجلسة غير موجودة.");
    if (action === "archive") {
      const [linked] = await tx.unsafe<Row[]>("select id from lithotripsy_pricing_profiles where session_id=$1::uuid and active=true and archived_at is null limit 1", [id]);
      if (linked) throw new OperationDomainError(409, "LITHO_SESSION_HAS_ACTIVE_LISTS", "أرشف قوائم الأسعار النشطة داخل الجلسة أولاً.");
      await tx.unsafe("update lithotripsy_sessions set active=false,archived_at=now(),updated_by_user_id=$2::uuid,updated_at=now() where id=$1::uuid", [id, userId]);
    }
    else await tx.unsafe("update lithotripsy_sessions set active=true,archived_at=null,updated_by_user_id=$2::uuid,updated_at=now() where id=$1::uuid", [id, userId]);
    const [row] = await tx.unsafe<Row[]>("select * from lithotripsy_sessions where id=$1::uuid", [id]);
    return dto(row);
  });
}
