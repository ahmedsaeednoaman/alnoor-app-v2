"use client";
import { useEffect, useRef, useState } from "react";
import { useDialogScrollLock } from "@/components/settings/users/use-dialog-scroll-lock";
import { taxInvoiceInputSchema, type TaxInvoice } from "@/lib/operations/tax-invoice";
import type { OperationalReviewItem } from "./operations-list";

export function OperationTaxInvoiceModal({ operation, onClose, onSaved }: { operation: OperationalReviewItem; onClose: () => void; onSaved: (invoice: TaxInvoice) => void }) {
  const dialog = useRef<HTMLDialogElement>(null), locked = useRef(false);
  const [registry, setRegistry] = useState(""), [number, setNumber] = useState(""), [error, setError] = useState(""), [saving, setSaving] = useState(false);
  useDialogScrollLock();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current!; element.showModal();
    return () => { element.close(); previous?.focus(); };
  }, []);
  const close = () => { if (!locked.current) onClose(); };
  return <dialog ref={dialog} className="operation-invoice-dialog" dir="rtl" aria-labelledby="invoice-title" onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close(); } }}>
    <form onSubmit={async event => {
      event.preventDefault(); if (locked.current) return;
      const parsed = taxInvoiceInputSchema.safeParse({ taxRegistry: registry, invoiceNumber: number });
      if (!parsed.success) { setError("اختر السجل الضريبي وأدخل رقم فاتورة من أرقام فقط (حتى 100 رقم)."); return; }
      locked.current = true; setSaving(true); setError("");
      try {
        const response = await fetch(`/api/v1/operations/${operation.id}/tax-invoice`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || "تعذر حفظ الفاتورة.");
        onSaved(data.taxInvoice);
      } catch (error) { setError(error instanceof Error ? error.message : "تعذر حفظ الفاتورة."); }
      finally { locked.current = false; setSaving(false); }
    }}>
      <h2 id="invoice-title">إصدار فاتورة ضريبية</h2>
      <p><strong>{operation.caseName || "بدون اسم حالة"}</strong><br/>{[{ contract: "تعاقد", lithotripsy: "تفتيت", endoscopy: "مناظير" }[operation.type], operation.doctorName, operation.hospitalName].filter(Boolean).join(" • ")}</p>
      <div className="operation-grid"><label>السجل الضريبي<select autoFocus required value={registry} onChange={event => setRegistry(event.target.value)} disabled={saving}><option value="">اختر السجل</option><option value="alnoor">النور</option><option value="alkawthar">الكوثر</option></select></label>
      <label>رقم الفاتورة<input required inputMode="numeric" pattern="[0-9]+" maxLength={100} dir="ltr" value={number} onChange={event => setNumber(event.target.value)} disabled={saving}/></label></div>
      {error && <p role="alert">{error}</p>}
      <footer><button type="submit" disabled={saving}>{saving ? "جارٍ الحفظ…" : "حفظ الفاتورة"}</button><button type="button" onClick={close} disabled={saving}>إلغاء</button></footer>
    </form>
  </dialog>;
}
