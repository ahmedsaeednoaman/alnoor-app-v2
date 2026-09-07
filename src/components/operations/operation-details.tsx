/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useDialogScrollLock } from "@/components/settings/users/use-dialog-scroll-lock";
import { WorkFormRenderer } from "./work-form-renderer";
import {
  validateWorkFormClient,
  type WorkFormValues,
} from "./work-form-rendering";
import type { BuilderTemplate } from "./work-form-types";

type DetailField = {
  id: string;
  stableKey: string;
  label: string;
  fieldType: string;
  value: unknown;
  display: string | string[];
};

type DetailSection = {
  id: string;
  label: string;
  description: string | null;
  fields: DetailField[];
};

type Details = {
  operation: {
    id: string;
    type: string;
    dailySequence: number;
    caseName: string;
    operationDate: string;
    operationTime: string;
    status: string;
  };

  template: {
    id: string;
    name: string;
    version: number;
  } | null;

  sections: DetailSection[];

  form: (BuilderTemplate & {
    values: WorkFormValues;
  }) | null;

  canEdit: boolean;
  canCancel?: boolean;
  canPrint?: boolean;
  editExpiresAt: string | null;

  financial?: null | {
    status: string;
    mainAmount: number;
    totalItems: number;
    doctorAccountAmount: number;
    paid: number;
    remaining: number;
    posted: boolean;
    items: Array<{
      id: string;
      description: string;
      amount: number;
    }>;
  };
};

const typeLabels: Record<string, string> = {
  lithotripsy: "تفتيت",
  endoscopy: "مناظير",
  contract: "تعاقد",
};

const typeIcons: Record<string, string> = {
  lithotripsy: "✦",
  endoscopy: "◉",
  contract: "▣",
};

const statusLabels: Record<string, string> = {
  active: "نشطة",
  completed: "مكتملة",
  cancelled: "ملغاة",
  reviewed: "تمت المراجعة",
  pending: "قيد المراجعة",
};

const meaningful = (field: DetailField) =>
  Array.isArray(field.display)
    ? field.display.length > 0
    : String(field.display ?? "").trim() !== "";

function formatMoney(value: number) {
  return new Intl.NumberFormat("ar-EG", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat("ar-EG", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(`${value}T12:00:00`));
  } catch {
    return value;
  }
}

function FieldValue({ field }: { field: DetailField }) {
  if (Array.isArray(field.display)) {
    return (
      <div className="op-detail-chips">
        {field.display.map((item, index) => (
          <span key={`${field.id}-${index}`}>{item}</span>
        ))}
      </div>
    );
  }

  if (field.fieldType === "date" && field.display) {
    return <>{formatDate(String(field.display))}</>;
  }

  if (field.fieldType === "money" && field.display) {
    const numericValue = Number(field.display);

    return (
      <>
        {Number.isFinite(numericValue)
          ? `${formatMoney(numericValue)} ج.م`
          : String(field.display)}
      </>
    );
  }

  return <>{String(field.display ?? "")}</>;
}

function DynamicDetails({ sections }: { sections: DetailSection[] }) {
  const meaningfulSections = sections
    .map((section) => ({
      ...section,
      fields: section.fields.filter(meaningful),
    }))
    .filter((section) => section.fields.length > 0);

  if (!meaningfulSections.length) {
    return (
      <div className="op-details-empty">
        <span>لا توجد تفاصيل إضافية مسجلة لهذه الحالة.</span>
      </div>
    );
  }

  return (
    <div className="op-detail-sections">
      {meaningfulSections.map((section, sectionIndex) => (
        <section
          className="op-detail-section"
          key={section.id}
        >
          <header className="op-detail-section__header">
            <div className="op-detail-section__number">
              {sectionIndex + 1}
            </div>

            <div>
              <h3>{section.label}</h3>

              {section.description && (
                <p>{section.description}</p>
              )}
            </div>
          </header>

          <div className="op-detail-fields">
            {section.fields.map((field) => (
              <article
                key={field.id}
                className={`op-detail-field ${
                  Array.isArray(field.display)
                    ? "op-detail-field--wide"
                    : ""
                }`}
              >
                <span className="op-detail-field__label">
                  {field.label}
                </span>

                <strong className="op-detail-field__value">
                  <FieldValue field={field} />
                </strong>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function FinancialDetails({
  financial,
  operationType,
}: {
  financial: Details["financial"];
  operationType: string;
}) {
  if (!financial) {
    return (
      <section className="op-financial-card op-financial-card--pending">
        <div className="op-financial-card__header">
          <div>
            <span>الحسابات</span>
            <h3>التفاصيل المالية</h3>
          </div>

          <span className="op-financial-status">
            بانتظار المراجعة
          </span>
        </div>

        <div className="op-financial-empty">
          <strong>لم تتم المراجعة المالية بعد</strong>
          <p>
            ستظهر البنود والقيم والحالة المالية هنا بعد مراجعة
            المحاسب.
          </p>
        </div>
      </section>
    );
  }

  const mainCards = [
    {
      label: "المبلغ الرئيسي",
      value: financial.mainAmount,
    },
    {
      label: "إجمالي البنود",
      value: financial.totalItems,
    },
    {
      label:
        operationType === "contract"
          ? "القيمة التعاقدية"
          : "حساب الطبيب",
      value: financial.doctorAccountAmount,
      highlight: true,
    },
  ];

  if (operationType !== "contract") {
    mainCards.push(
      {
        label: "المدفوع",
        value: financial.paid,
      },
      {
        label: "المتبقي",
        value: financial.remaining,
        highlight: financial.remaining > 0,
      },
    );
  }

  return (
    <section className="op-financial-card">
      <div className="op-financial-card__header">
        <div>
          <span>الحسابات</span>
          <h3>التفاصيل المالية</h3>
        </div>

        <span
          className={`op-financial-status ${
            financial.remaining > 0
              ? "is-pending"
              : "is-complete"
          }`}
        >
          {operationType === "contract"
            ? "تعاقد"
            : financial.remaining > 0
              ? "يوجد متبقي"
              : "مسدد"}
        </span>
      </div>

      <div className="op-financial-metrics">
        {mainCards.map((item) => (
          <article
            key={item.label}
            className={
              item.highlight
                ? "op-financial-metric is-highlight"
                : "op-financial-metric"
            }
          >
            <span>{item.label}</span>

            <strong>
              {formatMoney(Number(item.value || 0))}
              <small> ج.م</small>
            </strong>
          </article>
        ))}
      </div>

      {financial.items?.length > 0 && (
        <div className="op-financial-items">
          <div className="op-financial-items__title">
            <strong>البنود المالية</strong>
            <span>{financial.items.length} بنود</span>
          </div>

          <div className="op-financial-items__list">
            {financial.items.map((item) => (
              <div
                className="op-financial-item"
                key={item.id}
              >
                <span>{item.description}</span>

                <strong>
                  {formatMoney(item.amount)}
                  <small> ج.م</small>
                </strong>
              </div>
            ))}
          </div>
        </div>
      )}

      {operationType !== "contract" && (
        <div className="op-posting-state">
          <span>حالة الترحيل</span>

          <strong
            className={
              financial.posted ? "is-posted" : "is-not-posted"
            }
          >
            {financial.posted
              ? "تم الترحيل لحساب الطبيب"
              : "لم يتم الترحيل"}
          </strong>
        </div>
      )}
    </section>
  );
}

function OperationSummary({ data }: { data: Details }) {
  return (
    <section className="op-summary-card">
      <div className="op-summary-card__type">
        <span className={`op-type-icon ${data.operation.type}`}>
          {typeIcons[data.operation.type] ?? "•"}
        </span>

        <div>
          <small>نوع الحالة</small>
          <strong>
            {typeLabels[data.operation.type] ??
              data.operation.type}
          </strong>
        </div>
      </div>

      <div className="op-summary-card__meta">
        <div>
          <small>التاريخ</small>
          <strong>
            {formatDate(data.operation.operationDate)}
          </strong>
        </div>

        <div>
          <small>الوقت</small>
          <strong>{data.operation.operationTime}</strong>
        </div>

        <div>
          <small>رقم الحالة اليومي</small>
          <strong>#{data.operation.dailySequence}</strong>
        </div>

        <div>
          <small>الحالة</small>
          <strong>
            {statusLabels[data.operation.status] ??
              data.operation.status}
          </strong>
        </div>
      </div>
    </section>
  );
}

export function OperationDetails({
  operationId,
  onClose,
  onRefresh,
}: {
  operationId: string;
  onClose: () => void;
  onRefresh: () => void;
}) {
  useDialogScrollLock(true, false);

  const [data, setData] = useState<Details | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"details" | "edit">(
    "details",
  );
  const [values, setValues] = useState<WorkFormValues>({});
  const [initial, setInitial] = useState("");
  const [errors, setErrors] = useState<
    Record<string, string>
  >({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `/api/v1/operations/${operationId}`,
        {
          cache: "no-store",
        },
      );

      const body = await response.json();

      if (!response.ok) {
        setError(
          body.error?.message ??
            "تعذر تحميل تفاصيل العملية.",
        );
        return;
      }

      setData(body);

      if (body.form) {
        setValues(body.form.values);
        setInitial(JSON.stringify(body.form.values));
      }
    } catch {
      setError(
        "تعذر الاتصال بالخادم أثناء تحميل تفاصيل العملية.",
      );
    } finally {
      setLoading(false);
    }
  }, [operationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(
    () =>
      mode === "edit" &&
      JSON.stringify(values) !== initial,
    [initial, mode, values],
  );

  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => {
      if (!dirty) return;

      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", before);

    return () =>
      window.removeEventListener(
        "beforeunload",
        before,
      );
  }, [dirty]);

  function discard() {
    if (
      dirty &&
      !window.confirm(
        "لديك تعديلات غير محفوظة. هل تريد تجاهلها؟",
      )
    ) {
      return false;
    }

    return true;
  }

  function close() {
    if (discard()) {
      onClose();
    }
  }

  function cancelEdit() {
    if (!discard()) return;

    setMode("details");

    if (data?.form) {
      setValues(data.form.values);
      setInitial(JSON.stringify(data.form.values));
      setErrors({});
    }
  }

  async function save() {
    if (!data?.form || saving) return;

    const validation = validateWorkFormClient(
      data.form,
      values,
    );

    setErrors(validation);

    if (Object.keys(validation).length) {
      setError(
        "راجع الحقول المطلوبة قبل حفظ التعديلات.",
      );
      return;
    }

    setSaving(true);
    setError("");

    try {
      const response = await fetch(
        `/api/v1/operations/${operationId}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            formTemplateId: data.form.id,
            values,
          }),
        },
      );

      const body = await response.json();

      if (!response.ok) {
        setError(
          body.error?.message ??
            "تعذر حفظ التعديلات.",
        );
        return;
      }

      await load();
      setMode("details");
      onRefresh();
    } catch {
      setError(
        "تعذر الاتصال بالخادم أثناء حفظ التعديلات.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function cancelOperation() {
    const reason = window.prompt("سبب إلغاء العملية");

    if (!reason?.trim()) return;

    const response = await fetch(
      `/api/v1/operations/${operationId}/cancel`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          reason: reason.trim(),
        }),
      },
    );

    if (response.ok) {
      onClose();
      onRefresh();
      return;
    }

    const body = await response.json();

    setError(
      body.error?.message ??
        "تعذر إلغاء العملية.",
    );
  }

  return (
    <div
      className="operation-drawer operation-drawer-v2"
      role="dialog"
      aria-modal="true"
      aria-label={
        mode === "edit"
          ? "تعديل العملية"
          : "تفاصيل العملية"
      }
    >
      <button
        type="button"
        className="operation-drawer__backdrop"
        aria-label="إغلاق"
        onClick={close}
      />

      <section className="operation-drawer-v2__panel">
        <header className="operation-drawer-v2__header">
          <div className="operation-drawer-v2__heading">
            <span className="operation-drawer-v2__eyebrow">
              {data
                ? `الحالة #${data.operation.dailySequence} · ${
                    typeLabels[data.operation.type] ??
                    data.operation.type
                  }`
                : "تفاصيل العملية"}
            </span>

            <h2>
              {data?.operation.caseName ??
                "جاري التحميل..."}
            </h2>

            <div className="operation-drawer-v2__subline">
              {data?.template && (
                <span>
                  نموذج v{data.template.version}
                </span>
              )}

              {mode === "edit" && (
                <span className="is-editing">
                  وضع التعديل
                </span>
              )}

              {dirty && (
                <span className="is-dirty">
                  تعديلات غير محفوظة
                </span>
              )}
            </div>
          </div>

          <button
            type="button"
            className="operation-drawer-v2__close"
            aria-label="إغلاق"
            onClick={close}
          >
            ×
          </button>
        </header>

        <main className="operation-drawer-v2__body">
          {loading ? (
            <div className="op-details-loading">
              <span className="op-details-loading__spinner" />
              <strong>جاري تحميل التفاصيل...</strong>
              <small>لحظات وسيتم عرض بيانات الحالة</small>
            </div>
          ) : error && !data ? (
            <div className="op-details-error">
              <strong>تعذر تحميل الحالة</strong>
              <p>{error}</p>

              <button
                type="button"
                onClick={() => void load()}
              >
                إعادة المحاولة
              </button>
            </div>
          ) : data && mode === "edit" && data.form ? (
            <div className="op-edit-workspace">
              <div className="op-edit-banner">
                <div>
                  <strong>تعديل بيانات الحالة</strong>
                  <span>
                    تاريخ العملية ورقمها اليومي ثابتان في
                    التعديل الحالي.
                  </span>
                </div>

                {dirty && (
                  <span className="op-edit-banner__dirty">
                    غير محفوظ
                  </span>
                )}
              </div>

              <WorkFormRenderer
                template={data.form}
                values={values}
                errors={errors}
                canManageCatalogs={false}
                disabledKeys={["operation_date"]}
                onChange={(key, value) => {
                  setValues((current) => ({
                    ...current,
                    [key]: value,
                  }));

                  setErrors((current) => ({
                    ...current,
                    [key]: "",
                  }));

                  setError("");
                }}
              />
            </div>
          ) : data ? (
            <div className="op-details-workspace">
              <OperationSummary data={data} />

              <DynamicDetails sections={data.sections} />

              {"financial" in data && (
                <FinancialDetails
                  financial={data.financial}
                  operationType={data.operation.type}
                />
              )}
            </div>
          ) : null}

          {error && data && (
            <div className="op-inline-error" role="alert">
              {error}
            </div>
          )}
        </main>

        <footer className="operation-drawer-v2__footer">
          {mode === "edit" ? (
            <div className="op-footer-edit-actions">
              <button
                type="button"
                className="op-action-button op-action-button--primary"
                disabled={saving}
                onClick={() => void save()}
              >
                <span>✓</span>
                {saving
                  ? "جاري الحفظ..."
                  : "حفظ التعديلات"}
              </button>

              <button
                type="button"
                className="op-action-button"
                disabled={saving}
                onClick={cancelEdit}
              >
                إلغاء
              </button>
            </div>
          ) : (
            <>
              <div className="op-footer-primary-actions">
                {data?.canEdit && data.form && (
                  <button
                    type="button"
                    className="op-action-button op-action-button--primary"
                    onClick={() => {
                      setError("");
                      setMode("edit");
                    }}
                  >
                    <span>✎</span>
                    تعديل الحالة
                  </button>
                )}

                {data?.canPrint && (
                  <button
                    type="button"
                    className="op-action-button"
                    onClick={() =>
                      window.open(
                        `/print/operations/${operationId}`,
                        "_blank",
                        "noopener,noreferrer",
                      )
                    }
                  >
                    <span>▣</span>
                    طباعة
                  </button>
                )}
              </div>

              <div className="op-footer-secondary">
                {data?.editExpiresAt && (
                  <small className="op-edit-expiry">
                    متاح للتعديل حتى{" "}
                    {new Intl.DateTimeFormat("ar-EG", {
                      dateStyle: "short",
                      timeStyle: "short",
                    }).format(
                      new Date(data.editExpiresAt),
                    )}
                  </small>
                )}

                {data?.canCancel && (
                  <button
                    type="button"
                    className="op-action-button op-action-button--danger"
                    onClick={() =>
                      void cancelOperation()
                    }
                  >
                    إلغاء العملية
                  </button>
                )}
              </div>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}