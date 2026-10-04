import { z } from "zod";
import { createCatalogItem, isUniqueViolation } from "@/lib/catalogs/service";
import { formatCatalogName } from "@/lib/catalogs/normalize-name";
import { OperationDomainError } from "@/lib/operations/api";
import { resolveInlineReferenceSource } from "./inline-reference-sources";

const inputSchema = z.object({
  name: z.string().transform(formatCatalogName).pipe(z.string().min(2).max(200)),
}).strict();

// Required catalog defaults belong to this narrow server workflow. Never accept
// associations, lifecycle flags, or catalog-management fields from its caller.
const defaults: Record<string, Record<string, string>> = {
  procedures: { category: "عام" },
  equipment: { equipmentType: "عام" },
  stents: { stentType: "عام" },
  "contract-entities": { entityType: "other" },
};

export async function createInlineReference(source: string, input: unknown, userId: string) {
  const resolved = resolveInlineReferenceSource(source);
  if (!resolved) throw new OperationDomainError(400, "SMART_SOURCE_INVALID", "مصدر الإضافة غير صالح.");
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new OperationDomainError(400, "VALIDATION_ERROR", "يرجى إدخال اسم صحيح فقط (من حرفين إلى ٢٠٠ حرف).");
  try {
    const item = await createCatalogItem(resolved.catalog, {
      name: parsed.data.name, ...defaults[resolved.catalog],
    }, userId, false);
    return { id: item.id, name: item.name };
  } catch (error) {
    // The catalog's partial unique index serializes competing inserts. Do not
    // reactivate/reuse an unavailable record or perform a racy preflight lookup.
    if (isUniqueViolation(error)) throw new OperationDomainError(409,
      "CATALOG_NAME_ALREADY_EXISTS", "يوجد عنصر حالي بنفس الاسم في هذه القائمة.");
    throw error;
  }
}
