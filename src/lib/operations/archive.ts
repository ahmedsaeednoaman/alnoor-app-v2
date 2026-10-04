import { postgresClient } from "@/db/client";
import { OperationDomainError } from "./api";

export async function setOperationArchived(
  id: string, archived: boolean, reason: string | null,
  user: { id: string; permissions: string[] }, db = postgresClient,
) {
  if (!user.permissions.includes("operations.archive")) throw new OperationDomainError(403, "FORBIDDEN", "ليس لديك صلاحية إدارة أرشيف العمليات.");
  return db.begin(async tx => {
    const [operation] = await tx.unsafe<Array<{ archived_at: string | null }>>(
      "SELECT archived_at FROM operations WHERE id=$1::uuid FOR UPDATE", [id],
    );
    if (!operation) throw new OperationDomainError(404, "OPERATION_NOT_FOUND", "العملية غير موجودة.");
    if (Boolean(operation.archived_at) === archived) return { changed: false, archived };
    // Business status and every financial/reference relation are untouched.
    if (archived) await tx.unsafe(
      "UPDATE operations SET archived_at=now(),archived_by_user_id=$2::uuid,archive_reason=$3,updated_at=now() WHERE id=$1::uuid",
      [id, user.id, reason],
    );
    else await tx.unsafe(
      "UPDATE operations SET archived_at=NULL,archived_by_user_id=NULL,archive_reason=NULL,updated_at=now() WHERE id=$1::uuid", [id],
    );
    await tx.unsafe(
      "INSERT INTO operation_archive_events(operation_id,actor_user_id,action,reason) VALUES($1::uuid,$2::uuid,$3,$4)",
      [id, user.id, archived ? "archive" : "restore", archived ? reason : null],
    );
    return { changed: true, archived };
  });
}
