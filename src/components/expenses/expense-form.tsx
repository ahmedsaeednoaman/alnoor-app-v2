"use client";

import { useRef, useState } from "react";

function newIdempotencyKey() {
  return `expense-${crypto.randomUUID()}`;
}

export function ExpenseForm({ onSaved }: { onSaved?: () => void }) {
  const idempotencyKey = useRef("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [showNotes, setShowNotes] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!idempotencyKey.current) idempotencyKey.current = newIdempotencyKey();
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/v1/expenses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amount,
          description,
          notes: notes.trim() || null,
          idempotencyKey: idempotencyKey.current,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error?.message ?? "تعذر تسجيل المصروف.");
        return;
      }
      setAmount("");
      setDescription("");
      setNotes("");
      setShowNotes(false);
      idempotencyKey.current = "";
      setSuccess("تم تسجيل المصروف ضمن مستحقاتك.");
      onSaved?.();
    } catch {
      setError("تعذر الاتصال بالخادم. أعد المحاولة دون خوف من تكرار المصروف.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="expense-quick-form" onSubmit={submit}>
      <header>
        <span>تسجيل سريع</span>
        <h2>إضافة مصروف</h2>
        <p>سجّل ما دفعته من مالك الشخصي لشغل الشركة.</p>
      </header>
      <label className="expense-quick-form__amount">
        المبلغ
        <div>
          <input
            inputMode="decimal"
            dir="ltr"
            value={amount}
            placeholder="50"
            pattern="\d{1,9}(?:\.\d{1,2})?"
            onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/gu, ""))}
            required
          />
          <span>ج.م</span>
        </div>
      </label>
      <label>
        دفعت الفلوس في إيه؟
        <textarea
          value={description}
          minLength={2}
          maxLength={500}
          rows={2}
          placeholder="استأجرت عربية من المكتب لمستشفى الزينة"
          onChange={(event) => setDescription(event.target.value)}
          required
        />
      </label>
      {showNotes ? (
        <label>
          ملاحظات <small>(اختياري)</small>
          <textarea value={notes} maxLength={4000} rows={2} onChange={(event) => setNotes(event.target.value)} />
        </label>
      ) : (
        <button className="expense-notes-toggle" type="button" onClick={() => setShowNotes(true)}>+ إضافة ملاحظة اختيارية</button>
      )}
      {error && <p className="form-error expenses-notice" role="alert">{error}</p>}
      {success && <p className="form-success expenses-notice" role="status">{success}</p>}
      <button className="expense-submit" type="submit" disabled={busy}>
        {busy ? "جارٍ التسجيل…" : "تسجيل المصروف"}
      </button>
    </form>
  );
}
