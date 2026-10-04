"use client";
import { useEffect, useState } from "react";
import { SmartSelect } from "./smart-select";
import { resolveInlineReferenceSource } from "@/lib/work-forms/inline-reference-sources";
import { MoneyInput } from "./money-input";
import type { BuilderField, BuilderTemplate } from "./work-form-types";
import {
  selectOptions,
  sourceCatalogType,
  type WorkFormValues,
} from "./work-form-rendering";

type Props = {
  template: BuilderTemplate;
  values: WorkFormValues;
  errors: Record<string, string>;
  canCreateReferences?: boolean;
  canManageCatalogs: boolean;
  disabledKeys?: string[];
  onChange: (key: string, value: WorkFormValues[string]) => void;
};
type SessionOption={value:string;label:string};
function consumesSessionOptions(field: BuilderField) {
  // These controls return before the session select branch in FieldControl.
  return field.stableKey === "session_count" &&
    !["smart_single", "smart_multi", "textarea", "boolean"].includes(field.fieldType);
}
function FieldControl({
  field,
  value,
  onChange,
  canCreateReferences = false,
  canManageCatalogs,
  disabled,
  sessionOptions,
}: {
  field: BuilderField;
  value: WorkFormValues[string];
  onChange: (value: WorkFormValues[string]) => void;
  canCreateReferences?: boolean;
  canManageCatalogs: boolean;
  disabled: boolean;
  sessionOptions: SessionOption[];
}) {
  if (field.fieldType === "smart_single" || field.fieldType === "smart_multi") {
    const source = field.smartDropdownSource!;
    const inlineSource = resolveInlineReferenceSource(source);
    return (
      <SmartSelect
        label=""
        accessibleLabel={field.label}
        type={sourceCatalogType[source]}
        optionsEndpoint={`/api/v1/work-forms/references/${source}`}
        value={
          field.multiple
            ? Array.isArray(value)
              ? value
              : []
            : typeof value === "string"
              ? value
              : ""
        }
        multiple={field.multiple}
        maxSelections={field.maxSelections}
        canCreate={canCreateReferences && inlineSource !== null}
        inlineCreateSource={inlineSource?.source}
        canManage={canManageCatalogs && source !== "users"}
        onChange={onChange}
      />
    );
  }
  if (field.fieldType === "textarea")
    return (
      <textarea
        value={field.stableKey === "session_count" && typeof value === "number" ? String(value) : typeof value === "string" ? value : ""}
        placeholder={field.description ?? ""}
        onChange={(event) => onChange(event.target.value || null)}
      />
    );
  if (field.fieldType === "boolean")
    return (
      <div className="dynamic-boolean">
        <label>
          <input
            type="radio"
            checked={value === true}
            onChange={() => onChange(true)}
          />{" "}
          نعم
        </label>
        <label>
          <input
            type="radio"
            checked={value === false}
            onChange={() => onChange(false)}
          />{" "}
          لا
        </label>
      </div>
    );
  if (field.fieldType === "select" || consumesSessionOptions(field))
    return (
      <select
        value={field.stableKey === "session_count" && typeof value === "number" ? String(value) : typeof value === "string" ? value : ""}
        onChange={(event) => onChange(field.stableKey === "session_count" ? (event.target.value ? Number(event.target.value) : null) : event.target.value || null)}
      >
        <option value="">اختر...</option>
        {(consumesSessionOptions(field) ? sessionOptions : selectOptions(field)).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  if (field.fieldType === "money") return <MoneyInput value={value as string | number | null} disabled={disabled} placeholder={field.description ?? ""} onChange={onChange} />;
  const type = field.fieldType === "number" ? "number" : field.fieldType;
  return (
    <input
      disabled={disabled}
      type={type}
      min={undefined}
      step={field.fieldType === "number" ? "any" : undefined}
      value={value == null ? "" : String(value)}
      placeholder={field.description ?? ""}
      onChange={(event) => {
        const raw = event.target.value;
        if (!raw) return onChange(null);
        onChange(field.fieldType === "number" ? Number(raw) : raw);
      }}
    />
  );
}
export function WorkFormRenderer({
  template,
  values,
  errors,
  canCreateReferences = false,
  canManageCatalogs,
  disabledKeys = [],
  onChange,
}: Props) {
  const visibleSections = template.sections
    .filter(section => !section.archivedAt)
    .map(section => ({ ...section, fields: section.fields.filter(field => !field.archivedAt && field.showInForm) }))
    .filter(section => section.fields.length > 0);
  const needsSessionOptions = visibleSections.some(section => section.fields.some(consumesSessionOptions));
  const [sessionOptions,setSessionOptions]=useState<SessionOption[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    async function loadSessions() {
      // Clear options asynchronously on eligibility changes, including hiding
      // the consumer. Cleanup also guards responses whose JSON parsing finishes late.
      await Promise.resolve();
      if (controller.signal.aborted) return;
      setSessionOptions([]);
      if (!needsSessionOptions) return;
      try {
        const response = await fetch("/api/v1/lithotripsy/sessions", { cache: "no-store", signal: controller.signal });
        if (!response.ok || controller.signal.aborted) return;
        const body = await response.json();
        if (controller.signal.aborted) return;
        setSessionOptions((body.sessions ?? []).map((session: { sessionNumber: number; name: string }) => ({
          value: String(session.sessionNumber), label: session.name,
        })));
      } catch {
        // Preserve the existing non-blocking failure behavior.
      }
    }
    void loadSessions();
    return () => controller.abort();
  }, [needsSessionOptions]);
  return (
    <div className="dynamic-work-form" data-template-version={template.version}>
      {visibleSections.map((section) => {
          const fields = section.fields;
          const isDate = (field: BuilderField | undefined) => field?.stableKey === "operation_date" && field.fieldType === "date";
          const isTime = (field: BuilderField | undefined) => field?.stableKey === "operation_time" && field.fieldType === "time";
          return <section className="operation-card" key={section.id}>
            <header className="dynamic-section-header">
              <h3>{section.label}</h3>
              {section.description && <p>{section.description}</p>}
            </header>
            <div className="operation-grid">
              {fields.map((field, index) => (
                  <div
                    className={`dynamic-field ${["textarea", "smart_multi"].includes(field.fieldType) ? "wide" : ""} ${field.stableKey === "session_count" ? "dynamic-field--pricing-session" : ""} ${field.stableKey === "procedures" ? "dynamic-field--pricing-procedures" : ""}`}
                    key={field.id}
                    data-date-time-pair={isDate(field) && isTime(fields[index + 1]) || isTime(field) && isDate(fields[index - 1]) || undefined}
                  >
                    <label className="dynamic-field__label">
                      <span>
                        {field.label}
                        {field.required ? (
                          <b aria-label="إلزامي">*</b>
                        ) : (
                          <small>اختياري</small>
                        )}
                      </span>
                    </label>
                    <FieldControl
                      field={field}
                      value={values[field.stableKey] ?? null}
                      onChange={(value) => onChange(field.stableKey, value)}
                      canCreateReferences={canCreateReferences}
                      canManageCatalogs={canManageCatalogs}
                      disabled={disabledKeys.includes(field.stableKey)}
                      sessionOptions={needsSessionOptions ? sessionOptions : []}
                    />
                    {field.stableKey === "session_count" && <small className="dynamic-field__pricing-help">١. اختر جلسة التفتيت التي تمت.</small>}
                    {field.stableKey === "procedures" && <small className="dynamic-field__pricing-help">٢. اختر كل الإجراءات المستخدمة؛ الجلسة مع هذه المجموعة تحدد قائمة الأسعار المطابقة.</small>}
                    {errors[field.stableKey] && (
                      <small className="dynamic-field__error">
                        {errors[field.stableKey]}
                      </small>
                    )}
                  </div>
                ))}
            </div>
          </section>;
        })}
    </div>
  );
}
