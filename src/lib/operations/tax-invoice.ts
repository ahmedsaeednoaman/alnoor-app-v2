import { z } from "zod";
export const taxRegistryLabels = { alnoor: "النور", alkawthar: "الكوثر" } as const;
export const taxInvoiceInputSchema = z.object({
  taxRegistry: z.enum(["alnoor", "alkawthar"]),
  invoiceNumber: z.string().trim().min(1).max(100).regex(/^[0-9]+$/),
}).strict();
export type TaxInvoice = { id: string; registry: keyof typeof taxRegistryLabels; registryLabel: string; invoiceNumber: string; createdAt: string };
export function canCreateTaxInvoice(user: { permissions: string[] }) {
  return user.permissions.includes("operations.view") && user.permissions.includes("accounting.finance.edit");
}
export function invoicePredicate(status?: string) {
  if (status === "pending") return "o.type = 'contract' AND ti.id IS NULL";
  if (status === "completed" || status === "latest") return "ti.id IS NOT NULL";
  return "TRUE";
}
export function invoiceOrder(status?: string) {
  return status === "latest" ? "ti.created_at DESC, o.id DESC" : "o.operation_date DESC, o.daily_sequence DESC, o.id DESC";
}
