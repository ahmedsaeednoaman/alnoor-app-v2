/* eslint-disable @next/next/no-img-element */
"use client";

import type { PrintProjection } from "@/lib/printing/projection";

export function PrintDocument({ projection }: { projection: PrintProjection }) {
  return (
    <>
      <style jsx global>{`
        @page {
          size: A4 portrait;
          margin: 6mm 8mm;
        }

        .print-document {
          direction: rtl;
          max-width: 920px;
          margin: 0 auto;
          padding: 24px;
          background: #fff;
          color: #172033;
          box-sizing: border-box;
        }

        .print-document__actions {
          display: flex;
          justify-content: flex-start;
          gap: 8px;
          margin-bottom: 16px;
        }

        .print-document__actions button {
          padding: 8px 16px;
          border: 1px solid #0f4c81;
          border-radius: 7px;
          background: #fff;
          color: #0f4c81;
          font-weight: 700;
          cursor: pointer;
        }

        .print-header {
          display: flex;
          align-items: center;
          gap: 14px;
          border-bottom: 2px solid #0f4c81;
          padding-bottom: 8px;
          margin-bottom: 8px;
        }

        .print-header img {
          width: 65px;
          height: 65px;
          object-fit: contain;
        }

        .print-header h1 {
          margin: 0;
          font-size: 20px;
          color: #0f4c81;
        }

        .print-header p {
          margin: 2px 0 0;
          font-size: 12px;
        }

        .print-meta {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 6px;
          padding: 8px 0;
          border-bottom: 1px solid #cbd5e1;
          font-size: 12px;
          font-weight: 600;
        }

        .print-section {
          break-inside: avoid;
          page-break-inside: avoid;
          border-bottom: 1px solid #cbd5e1;
          padding: 8px 0;
        }

        .print-section h2 {
          font-size: 14px;
          color: #0f4c81;
          margin: 0 0 6px;
        }

        .print-section dl {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 6px;
          margin: 0;
        }

        .print-section dl > div {
          display: grid;
          grid-template-columns: 35% 65%;
          gap: 6px;
          border: 1px solid #e2e8f0;
          padding: 4px 6px;
          font-size: 11px;
          line-height: 1.3;
          overflow-wrap: anywhere;
        }

        .print-section dt {
          font-weight: 700;
          color: #475569;
        }

        .print-section dd {
          margin: 0;
        }

        .print-footer {
          text-align: center;
          color: #64748b;
          font-size: 9px;
          margin-top: 10px;
          padding-top: 4px;
        }

        @media (max-width: 767px) {
          .print-document {
            padding: 16px;
          }
          .print-meta,
          .print-section dl {
            grid-template-columns: 1fr;
          }
        }

        @media print {
          html,
          body {
            height: 100%;
            background: #fff !important;
            overflow: hidden !important;
          }

          body * {
            visibility: hidden;
          }

          .print-document,
          .print-document * {
            visibility: visible;
          }

          .print-document {
            position: absolute;
            left: 0;
            top: 0;
            width: 100% !important;
            max-width: none !important;
            margin: 0 !important;
            padding: 0 !important;
            background: transparent !important;
          }

          .print-document__actions {
            display: none !important;
          }

          .app-shell__background,
          .app-shell__workspace > header,
          .app-shell__workspace > aside,
          .app-shell__content > nav {
            display: none !important;
          }

          .print-section {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
            padding: 6px 0 !important;
          }

          .print-section dl > div {
            padding: 3px 5px !important;
            font-size: 10.5px !important;
          }
        }
      `}</style>

      <main className="print-document" dir="rtl">
        <div className="print-document__actions">
          <button onClick={() => window.print()}>طباعة</button>
          <button onClick={() => window.history.back()}>رجوع</button>
        </div>

        <header className="print-header">
          <img
            src="/images/Al-Noor Endoscope Medical Logo.png"
            alt="النور للمناظير الطبية"
          />
          <div>
            <h1>تفاصيل العملية</h1>
            <p>
              الحالة #{projection.operation.dailySequence} ·{" "}
              {projection.operation.date}
            </p>
          </div>
        </header>

        <div className="print-meta">
          <span>اسم الحالة: {projection.operation.caseName}</span>
          <span>المستشفى: {projection.operation.hospital || "—"}</span>
          <span>المرجع: {projection.operation.reference || "—"}</span>
        </div>

        {projection.sections.map((section) => (
          <section className="print-section" key={section.id}>
            <h2>{section.label}</h2>
            <dl>
              {section.fields.map((field) => (
                <div key={field.id}>
                  <dt>{field.label}</dt>
                  <dd>
                    {Array.isArray(field.value)
                      ? field.value.join("، ")
                      : field.value}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}

        {projection.financial && (
          <section className="print-section print-financial">
            <h2>التفاصيل المالية</h2>
            <dl>
              {[
                ["المبلغ الرئيسي", projection.financial.mainAmount],
                ["إجمالي الإضافات", projection.financial.additions],
                ["إجمالي الخصومات", projection.financial.deductions],
                ["الرصيد النهائي", projection.financial.finalBalance],
                ["المدفوع", projection.financial.paid],
                ["المتبقي", projection.financial.remaining],
                [
                  "حالة الترحيل",
                  projection.financial.posted
                    ? "تم الترحيل"
                    : projection.financial.doctorBalanceReceived
                    ? "استلمه الطبيب"
                    : "غير مرحل",
                ],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <dt>{label}</dt>
                  <dd>
                    {typeof value === "number"
                      ? value.toFixed(2)
                      : String(value)}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        <footer className="print-footer">
          النور للمناظير الطبية · إصدار النموذج التاريخي v
          {projection.template.version}
        </footer>
      </main>
    </>
  );
}