"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import type { DoctorAccountSummary } from "@/lib/doctor-accounts";

const moneyFormatter = new Intl.NumberFormat("ar-EG", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function money(value: number) {
  return moneyFormatter.format(Object.is(value, -0) ? 0 : value);
}

function balanceMeta(balance: number) {
  if (balance > 0) {
    return {
      className: "is-debit",
      title: "مستحق على الطبيب",
      helper: "يوجد رصيد مطلوب تحصيله من الطبيب",
    };
  }

  if (balance < 0) {
    return {
      className: "is-credit",
      title: "رصيد لصالح الطبيب",
      helper: "يوجد رصيد مستحق للطبيب",
    };
  }

  return {
    className: "is-zero",
    title: "الحساب مسوّى",
    helper: "لا يوجد رصيد حالي",
  };
}

export function DoctorAccountsList({
  initialDoctors,
}: {
  initialDoctors: DoctorAccountSummary[];
}) {
  const [doctors, setDoctors] = useState(initialDoctors);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();

    setBusy(true);
    setError("");

    try {
      const response = await fetch(
        `/api/v1/doctor-accounts?search=${encodeURIComponent(search.trim())}`,
        { cache: "no-store" },
      );

      const body = await response.json();

      if (!response.ok) {
        throw new Error(
          body?.error?.message ?? "تعذر تحميل حسابات الأطباء.",
        );
      }

      setDoctors(body.doctors ?? []);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "حدث خطأ أثناء تحميل الحسابات.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function clearSearch() {
    setSearch("");
    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/v1/doctor-accounts", {
        cache: "no-store",
      });

      const body = await response.json();

      if (!response.ok) {
        throw new Error(
          body?.error?.message ?? "تعذر تحميل حسابات الأطباء.",
        );
      }

      setDoctors(body.doctors ?? []);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "حدث خطأ أثناء تحميل الحسابات.",
      );
    } finally {
      setBusy(false);
    }
  }

  const summary = useMemo(() => {
    let debit = 0;
    let credit = 0;
    let active = 0;

    for (const doctor of doctors) {
      if (doctor.balance > 0) {
        debit += doctor.balance;
        active++;
      } else if (doctor.balance < 0) {
        credit += Math.abs(doctor.balance);
        active++;
      }
    }

    return {
      doctors: doctors.length,
      active,
      debit,
      credit,
    };
  }, [doctors]);

  return (
    <main className="doctor-accounts-page" dir="rtl">
      <header className="doctor-accounts-hero">
        <div className="doctor-accounts-hero__content">
          <span className="doctor-accounts-eyebrow">
            الحسابات
          </span>

          <h1>حسابات الأطباء</h1>

          <p>
            متابعة حساب كل طبيب من حالات التفتيت والمناظير،
            وتسجيل الدفعات والتسويات من مكان واحد.
          </p>
        </div>

        <div className="doctor-accounts-hero__summary">
          <article>
            <span>الأطباء</span>
            <strong>{summary.doctors}</strong>
          </article>

          <article>
            <span>حسابات بها رصيد</span>
            <strong>{summary.active}</strong>
          </article>

          <article className="is-debit">
            <span>إجمالي المستحق</span>
            <strong>
              {money(summary.debit)}
              <small> ج.م</small>
            </strong>
          </article>
        </div>
      </header>

      <section className="doctor-account-search-panel">
        <div>
          <span>دليل الحسابات</span>
          <h2>اختر الطبيب</h2>
          <p>
            الطبيب مرتبط بنفس السجل المستخدم داخل العمليات.
          </p>
        </div>

        <form className="doctor-account-search" onSubmit={submit}>
          <label htmlFor="doctor-search">
            بحث باسم الطبيب
          </label>

          <div className="doctor-account-search__control">
            <input
              id="doctor-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="مثال: د. أحمد محمد"
              autoComplete="off"
            />

            {search && (
              <button
                type="button"
                className="doctor-account-search__clear"
                onClick={() => void clearSearch()}
                aria-label="مسح البحث"
              >
                ×
              </button>
            )}

            <button
              type="submit"
              className="primary"
              disabled={busy}
            >
              {busy ? "جارٍ البحث..." : "بحث"}
            </button>
          </div>
        </form>
      </section>

      {error && (
        <div className="doctor-account-page-error">
          {error}
        </div>
      )}

      {doctors.length ? (
        <section
          className="doctor-account-grid"
          aria-label="حسابات الأطباء"
        >
          {doctors.map((doctor) => {
            const state = balanceMeta(doctor.balance);

            return (
              <article
                className="doctor-account-card"
                key={doctor.doctorId}
              >
                <header className="doctor-account-card__header">
                  <span
                    className="doctor-account-avatar"
                    aria-hidden="true"
                  >
                    د
                  </span>

                  <div>
                    <h2>{doctor.doctorName}</h2>

                    <p>
                      {doctor.specialty || "طبيب"}
                    </p>
                  </div>
                </header>

                <section
                  className={`doctor-account-card__balance ${state.className}`}
                >
                  <span>{state.title}</span>

                  <strong>
                    {money(doctor.balance)}
                    <small> ج.م</small>
                  </strong>

                  <p>{state.helper}</p>
                </section>

                <div className="doctor-account-card__meta">
                  <div>
                    <span>عدد الحركات</span>
                    <strong>{doctor.movementCount}</strong>
                  </div>

                  <div>
                    <span>آخر حركة</span>
                    <strong>
                      {doctor.lastMovementAt
                        ? new Date(
                            doctor.lastMovementAt,
                          ).toLocaleDateString("ar-EG", {
                            timeZone: "Africa/Cairo",
                          })
                        : "لا توجد"}
                    </strong>
                  </div>
                </div>

                <footer>
                  <Link
                    href={`/doctor-accounts/${doctor.doctorId}`}
                  >
                    <span>فتح حساب الطبيب</span>
                    <b aria-hidden="true">←</b>
                  </Link>
                </footer>
              </article>
            );
          })}
        </section>
      ) : (
        <section className="doctor-account-empty">
          <span className="doctor-account-empty__icon">
            د
          </span>

          <h2>لا توجد نتائج</h2>

          <p>
            لا يوجد طبيب مطابق للبحث الحالي.
          </p>

          {search && (
            <button onClick={() => void clearSearch()}>
              عرض جميع الأطباء
            </button>
          )}
        </section>
      )}
    </main>
  );
}
