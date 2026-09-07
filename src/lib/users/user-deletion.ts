import { postgresClient } from "@/db/client";

export type UserDeletionReference = {
  table: string;
  count: number;
};

export type UserDeletionEligibility =
  | { allowed: true; references: [] }
  | { allowed: false; references: UserDeletionReference[] };

/**
 * Authentication-only rows cascade. Catalog creator references are historical
 * attribution and therefore block hard deletion. technicians.linked_user_id
 * deliberately uses ON DELETE SET NULL and is not a blocker.
 */
export async function canHardDeleteUser(
  userId: string,
): Promise<UserDeletionEligibility> {
  const historicalReferences = [
    ...["doctors", "contract_entities", "hospitals", "procedures", "equipment", "consumables", "anesthesiologists", "technicians", "financial_item_catalog", "operation_financial_items", "operation_financial_payments"].map((table) => ({ table, predicate: "created_by_user_id = $1::uuid" })),
    { table: "operations", predicate: "created_by_user_id = $1::uuid OR updated_by_user_id = $1::uuid OR cancelled_by_user_id = $1::uuid" },
    { table: "operation_financial_reviews", predicate: "reviewed_by_user_id = $1::uuid" },
    { table: "doctor_account_postings", predicate: "posted_by_user_id = $1::uuid" },
    { table: "work_form_templates", predicate: "created_by_user_id = $1::uuid OR updated_by_user_id = $1::uuid" },
  ] as const;

  const references = await Promise.all(
    historicalReferences.map(async ({ table, predicate }) => {
      const rows = await postgresClient.unsafe<Array<{ count: number }>>(
        `SELECT count(*)::int AS count
           FROM "${table}"
          WHERE ${predicate}`,
        [userId],
      );

      return { table, count: rows[0]?.count ?? 0 };
    }),
  );
  const blockers = references.filter((reference) => reference.count > 0);

  return blockers.length > 0
    ? { allowed: false, references: blockers }
    : { allowed: true, references: [] };
}
