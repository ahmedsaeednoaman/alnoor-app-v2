import { postgresClient } from "@/db/client";
import { PermissionDeniedError } from "@/lib/auth/guards";
import { OperationDomainError } from "./api";
import { canCreateTaxInvoice, taxInvoiceInputSchema, taxRegistryLabels, type TaxInvoice } from "./tax-invoice";

export async function createTaxInvoice(operationId: string, input: unknown, user: { id: string; role: { code: string }; permissions: string[] }) {
  if (!canCreateTaxInvoice(user)) throw new PermissionDeniedError("accounting.finance.edit");
  const parsed = taxInvoiceInputSchema.safeParse(input);
  if (!parsed.success) throw new OperationDomainError(400, "VALIDATION_ERROR", "السجل ورقم الفاتورة غير صحيحين.");
  return postgresClient.begin(async (tx) => {
    const [operation] = await tx.unsafe<{ id: string }[]>(
      `SELECT id FROM operations WHERE id=$1::uuid AND status <> 'cancelled'
       AND ($2::boolean = false OR (created_by_user_id=$3::uuid AND operation_date >= current_date - 6)) FOR UPDATE`,
      [operationId, user.role.code === "employee", user.id],
    );
    if (!operation) throw new OperationDomainError(404, "OPERATION_NOT_FOUND", "الحالة غير موجودة أو غير متاحة.");
    await tx.unsafe(`INSERT INTO operation_tax_invoices(operation_id,tax_registry,invoice_number,created_by_user_id)
      VALUES($1::uuid,$2,$3,$4::uuid) ON CONFLICT(operation_id) DO NOTHING`,
    [operationId, parsed.data.taxRegistry, parsed.data.invoiceNumber, user.id]);
    const [invoice] = await tx.unsafe<Omit<TaxInvoice, "registryLabel">[]>(
      `SELECT id,tax_registry AS registry,invoice_number AS "invoiceNumber",created_at AS "createdAt" FROM operation_tax_invoices WHERE operation_id=$1::uuid`, [operationId]);
    return { ...invoice, registryLabel: taxRegistryLabels[invoice.registry] };
  });
}
