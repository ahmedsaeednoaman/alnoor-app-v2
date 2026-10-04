"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { useAuthenticatedRequestScope } from "@/components/auth/request-scope-provider";

export type OperationManagementAction = "archive" | "restore" | "cancel";
export function OperationManagementActions({ id, archived, status, canArchive, canCancel, onChanged, onError }: {
  id: string; archived: boolean; status: string; canArchive: boolean; canCancel: boolean;
  onChanged: (action: OperationManagementAction) => void; onError: (message: string) => void;
}) {
  const { capture, isCurrent, deny } = useAuthenticatedRequestScope();
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const mounted = useRef(true);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = useRef({ id, onChanged, onError });
  useLayoutEffect(() => { current.current = { id, onChanged, onError }; }, [id, onChanged, onError]);
  async function act(action: OperationManagementAction) {
    if (locked.current) return;
    if (action === "cancel" ? !canCancel || archived || status === "cancelled" : !canArchive) return;
    let body: { reason?: string } = {};
    if (action === "archive") {
      if (!window.confirm("سيتم إخفاء الحالة من قوائم العمل النشطة مع الاحتفاظ بسجلها. هل تريد الأرشفة؟")) return;
      const reason = window.prompt("سبب الأرشفة (اختياري)", "");
      if (reason === null) return;
      body = { reason: reason.trim() };
    } else if (action === "restore") {
      if (!window.confirm("استعادة الحالة من الأرشيف مع الاحتفاظ بحالتها الأصلية؟")) return;
    } else {
      const reason = window.prompt("سبب إلغاء العملية");
      if (reason === null) return;
      if (reason.trim().length < 3 || reason.trim().length > 2000) { onError("سبب الإلغاء مطلوب (من 3 إلى 2000 حرف)."); return; }
      body = { reason: reason.trim() };
    }
    const ticket = capture(); if (!ticket) return;
    locked.current = true; setBusy(true);
    try {
      const response = await fetch(`/api/v1/operations/${id}/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({}));
      if (!mounted.current || !isCurrent(ticket) || current.current.id !== id) return;
      if ([401, 403].includes(response.status)) { deny(); return; }
      if (!response.ok) { current.current.onError(result.error?.message ?? "تعذر تنفيذ الإجراء."); return; }
      current.current.onChanged(action);
    } catch {
      if (mounted.current && isCurrent(ticket) && current.current.id === id) current.current.onError("تعذر تأكيد الإجراء. حدّث القائمة للتحقق قبل إعادة المحاولة.");
    } finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  return <>
    {canArchive && <button type="button" className="op-action-button" disabled={busy} onClick={() => void act(archived ? "restore" : "archive")}>{archived ? "استعادة من الأرشيف" : "أرشفة"}</button>}
    {canCancel && !archived && status !== "cancelled" && <button type="button" className="op-action-button op-action-button--danger" disabled={busy} onClick={() => void act("cancel")}>إلغاء</button>}
  </>;
}
