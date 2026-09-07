"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { WorkFormRenderer } from "./work-form-renderer";
import {
  validateWorkFormClient,
  type WorkFormValues,
} from "./work-form-rendering";
import type { BuilderTemplate } from "./work-form-types";
type Response = {
  operation: { dailySequence: number; caseName: string };
  canEdit: boolean;
  form: (BuilderTemplate & { values: WorkFormValues }) | null;
};
export function OperationEditor({ id }: { id: string }) {
  const router = useRouter(),
    [data, setData] = useState<Response | null>(null),
    [values, setValues] = useState<WorkFormValues>({}),
    [initial, setInitial] = useState(""),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  useEffect(() => {
    fetch(`/api/v1/operations/${id}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message);
        return body;
      })
      .then((body) => {
        setData(body);
        if (body.form) {
          setValues(body.form.values);
          setInitial(JSON.stringify(body.form.values));
        }
      })
      .catch((reason) => setError(reason.message));
  }, [id]);
  const dirty = useMemo(
    () => JSON.stringify(values) !== initial,
    [initial, values],
  );
  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [dirty]);
  if (error && !data) return <p className="operations-state error">{error}</p>;
  if (!data) return <p className="operations-state">جاري تحميل العملية...</p>;
  if (!data.canEdit || !data.form)
    return (
      <p className="operations-state error">هذه العملية متاحة للقراءة فقط.</p>
    );
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!data?.form) return;
    const validation = validateWorkFormClient(data.form, values);
    setErrors(validation);
    if (Object.keys(validation).length) return;
    setSaving(true);
    const response = await fetch(`/api/v1/operations/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ formTemplateId: data.form.id, values }),
    });
    const body = await response.json();
    setSaving(false);
    if (!response.ok) {
      setError(body.error?.message ?? "تعذر الحفظ");
      return;
    }
    setInitial(JSON.stringify(values));
    router.push("/operations");
    router.refresh();
  }
  function cancel() {
    if (dirty && !confirm("لديك تعديلات غير محفوظة. هل تريد تجاهلها؟")) return;
    router.back();
  }
  return (
    <form className="operation-form" onSubmit={save}>
      <header className="operations-hero">
        <div>
          <span>تعديل العملية #{data.operation.dailySequence}</span>
          <h2>{data.operation.caseName}</h2>
          <p>
            يستخدم التعديل إصدار النموذج التاريخي نفسه، مع تثبيت تاريخ العملية
            ورقمها.
          </p>
        </div>
      </header>
      <WorkFormRenderer
        template={data.form}
        values={values}
        errors={errors}
        canManageCatalogs={false}
        disabledKeys={["operation_date"]}
        onChange={(key, value) => {
          setValues((current) => ({ ...current, [key]: value }));
          setErrors((current) => ({ ...current, [key]: "" }));
        }}
      />
      {error && <p className="operation-error">{error}</p>}
      <footer className="operation-actions">
        <button className="primary" disabled={saving}>
          {saving ? "جاري الحفظ..." : "حفظ التعديلات"}
        </button>
        <button type="button" onClick={cancel}>
          إلغاء
        </button>
      </footer>
    </form>
  );
}
