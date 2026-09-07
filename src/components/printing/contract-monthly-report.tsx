/* eslint-disable @next/next/no-img-element */
/* eslint-disable react-hooks/set-state-in-effect */
"use client";
import { useCallback, useEffect, useState } from "react";
import { SmartSelect } from "@/components/operations/smart-select";

type Report = {
  month: number;
  year: number;
  total: number;
  pageCount: number;
  rows: Array<{
    sequence: number;
    caseName: string;
    reference: string;
    hospital: string;
    contractEntity: string;
    value: number | null;
    details: string[];
  }>;
};
const months = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

export function ContractMonthlyReport() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [hospital, setHospital] = useState("");
  const [entity, setEntity] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const q = new URLSearchParams({ month: String(month), year: String(year) });
    if (hospital) q.set("hospitalId", hospital);
    if (entity) q.set("contractEntityId", entity);
    const response = await fetch(`/api/v1/reports/contracts/monthly?${q}`, {
      cache: "no-store",
    });
    const body = await response.json();
    setLoading(false);
    if (!response.ok) {
      setError(body.error?.message ?? "تعذر تحميل التقرير.");
      return;
    }
    setReport(body);
  }, [entity, hospital, month, year]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <>
      <style jsx global>{`
        @page {
          size: A4 portrait;
          margin: 12mm;
        }
        .report-page {
          display: grid;
          gap: 18px;
        }
        .report-filters {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 12px;
          padding: 18px;
          border: 1px solid #dbe4ee;
          border-radius: 16px;
        }
        .report-filters label {
          display: grid;
          gap: 7px;
          font-size: 12px;
        }
        .report-filters input,
        .report-filters select {
          min-height: 42px;
        }
        .report-preview-actions {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .contract-report-pages {
          display: grid;
          gap: 18px;
        }
        .contract-report-page {
          background: #fff;
          color: #122033;
          padding: 20px;
          box-shadow: 0 8px 30px rgba(15, 23, 42, 0.14);
          border-radius: 4px;
        }
        .contract-report-page > header {
          display: flex;
          align-items: center;
          gap: 14px;
          border-bottom: 2px solid #0f4c81;
          padding-bottom: 10px;
        }
        .contract-report-page > header img {
          width: 72px;
          height: 72px;
          object-fit: contain;
        }
        .contract-report-page > header h2 {
          margin: 0;
          color: #0f4c81;
        }
        .contract-report-page table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
          margin-top: 16px;
          font-size: 12px;
        }
        .contract-report-page th,
        .contract-report-page td {
          border: 1px solid #94a3b8;
          padding: 7px;
          text-align: right;
          vertical-align: top;
          overflow-wrap: anywhere;
        }
        .contract-report-page th {
          background: #e2f3f7;
          color: #0f3b59;
        }
        .contract-report-page th:nth-child(1) {
          width: 5%;
        }
        .contract-report-page th:nth-child(2) {
          width: 22%;
        }
        .contract-report-page th:nth-child(3) {
          width: 18%;
        }
        .contract-report-page th:nth-child(4) {
          width: 18%;
        }
        .contract-report-page th:nth-child(5) {
          width: 27%;
        }
        .contract-report-page th:nth-child(6) {
          width: 10%;
        }
        .contract-report-page > footer {
          text-align: center;
          color: #64748b;
          font-size: 10px;
          margin-top: 12px;
        }
        @media (max-width: 767px) {
          .report-filters {
            grid-template-columns: 1fr;
          }
          .contract-report-page {
            padding: 10px;
            overflow-x: auto;
          }
          .contract-report-page table {
            min-width: 720px;
          }
        }
        @media print {
          body * {
            visibility: hidden;
          }
          .contract-report-pages,
          .contract-report-pages * {
            visibility: visible;
          }
          .report-page > .operations-hero,
          .report-page > .report-filters,
          .report-preview-actions {
            display: none !important;
          }
          .contract-report-pages {
            display: block;
            position: absolute;
            inset: 0;
            background: #fff;
          }
          .contract-report-page {
            box-shadow: none;
            border: 0;
            border-radius: 0;
            min-height: 270mm;
            padding: 0;
            page-break-after: always;
          }
          .contract-report-page:last-child {
            page-break-after: auto;
          }
          .contract-report-page thead {
            display: table-header-group;
          }
          .contract-report-page tr {
            break-inside: avoid;
          }
          .contract-report-page > header {
            break-inside: avoid;
          }
        }
      `}</style>
      <main className="report-page" dir="rtl">
        <header className="operations-hero">
          <div>
            <span>التقارير</span>
            <h1>تقرير التعاقد الشهري</h1>
            <p>يُبنى التقرير من العمليات والمراجعات المالية المحفوظة.</p>
          </div>
        </header>
        <section className="report-filters">
          <label>
            الشهر
            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
            >
              {months.map((label, index) => (
                <option value={index + 1} key={label}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            السنة
            <input
              type="number"
              value={year}
              min={2000}
              max={2200}
              onChange={(e) => setYear(Number(e.target.value))}
            />
          </label>
          <SmartSelect
            label="المستشفى"
            type="hospitals"
            value={hospital}
            onChange={(value) => setHospital(value as string)}
            canManage={false}
          />
          <SmartSelect
            label="جهة التعاقد"
            type="contract-entities"
            value={entity}
            onChange={(value) => setEntity(value as string)}
            canManage={false}
          />
          <button className="button-primary" onClick={() => void load()}>
            عرض التقرير
          </button>
        </section>
        {error && <p className="operations-state error">{error}</p>}
        {loading && <p className="operations-state">جاري تجهيز التقرير...</p>}
        {report && (
          <>
            <div className="report-preview-actions">
              <span>
                {report.total} حالة · {report.pageCount} صفحة
              </span>
              <button className="button-primary" onClick={() => window.print()}>
                طباعة
              </button>
            </div>
            {report.total === 0 ? (
              <p className="operations-state">
                لا توجد حالات تعاقد مطابقة للفترة المحددة.
              </p>
            ) : (
              <div className="contract-report-pages">
                {Array.from({ length: report.pageCount }, (_, page) => (
                  <section className="contract-report-page" key={page}>
                    <header>
                      <img
                        src="/images/Al-Noor Endoscope Medical Logo.png"
                        alt="النور"
                      />
                      <div>
                        <h2>تقرير التعاقد الشهري</h2>
                        <p>
                          {months[report.month - 1]} {report.year} · الصفحة{" "}
                          {page + 1} من {report.pageCount}
                        </p>
                      </div>
                    </header>
                    <table>
                      <thead>
                        <tr>
                          <th>م</th>
                          <th>اسم الحالة</th>
                          <th>الرقم الموحد / المرجع</th>
                          <th>المستشفى</th>
                          <th>الإجراء / الجهاز</th>
                          <th>القيمة</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.rows
                          .slice(page * 15, page * 15 + 15)
                          .map((row) => (
                            <tr key={row.sequence}>
                              <td>{row.sequence}</td>
                              <td>{row.caseName}</td>
                              <td>{row.reference || "—"}</td>
                              <td>{row.hospital || "—"}</td>
                              <td>
                                {row.details.join(" · ") ||
                                  row.contractEntity ||
                                  "—"}
                              </td>
                              <td>
                                {row.value == null ? "—" : row.value.toFixed(2)}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                    <footer>
                      النور للمناظير الطبية · {months[report.month - 1]}{" "}
                      {report.year}
                    </footer>
                  </section>
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}
