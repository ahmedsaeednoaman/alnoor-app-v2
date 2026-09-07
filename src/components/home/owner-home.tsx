import Link from "next/link";

import type { HomeData, HomeOperation, HomeReviewItem } from "@/lib/home";

type OwnerHomeProps = { home: HomeData };

const operationTypeLabels: Record<HomeOperation["type"], string> = {
  lithotripsy: "تفتيت",
  endoscopy: "مناظير",
  contract: "تعاقد",
};

const amountFormatter = new Intl.NumberFormat("ar-EG", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const countFormatter = new Intl.NumberFormat("ar-EG");

function WorkItem({ operation }: { operation: HomeReviewItem }) {
  const context = [operation.doctorName, operation.hospitalName]
    .filter(Boolean)
    .join(" · ");

  return (
    <article className="owner-home__work-item">
      <div>
        <span>{operationTypeLabels[operation.type]}</span>
        <time dateTime={`${operation.date}T${operation.time}`}>
          {operation.date} · <bdi>{operation.time}</bdi>
        </time>
      </div>
      <strong>{operation.caseName.trim() || "بدون اسم حالة"}</strong>
      {context && <small>{context}</small>}
    </article>
  );
}

export function OwnerHome({ home }: OwnerHomeProps) {
  const { capabilities } = home;
  const actions = [
    capabilities.canReviewWork
      ? { href: "/accounts/review", label: "مراجعة الشغل", detail: "اعتماد المراجعات المالية" }
      : null,
    capabilities.canViewDoctorAccounts
      ? { href: "/doctor-accounts", label: "حسابات الأطباء", detail: "عرض الأرصدة والحركات" }
      : null,
    capabilities.canViewOperations
      ? { href: "/operations", label: "عرض الشغل", detail: "سجل العمليات" }
      : null,
    capabilities.canAddWork
      ? { href: "/operations/new", label: "إضافة شغل", detail: "تسجيل عملية جديدة" }
      : null,
    capabilities.canViewReports
      ? { href: "/reports", label: "التقارير", detail: "فتح التقارير المتاحة" }
      : null,
    capabilities.canUsePrinting
      ? { href: "/print", label: "الطباعة", detail: "فتح مركز الطباعة" }
      : null,
    capabilities.canViewSettings
      ? { href: "/settings", label: "الإعدادات", detail: "إدارة إعدادات النظام" }
      : null,
  ].filter((action): action is NonNullable<typeof action> => action !== null);

  return (
    <main className="owner-home">
      <header className="owner-home__greeting">
        <div>
          <p>أهلاً،</p>
          <h1>{home.identity.displayName}</h1>
        </div>
        <span>صاحب الشركة</span>
      </header>

      <section className="owner-home__summary" aria-label="نظرة عامة">
        {capabilities.canViewOperations && home.today && (
          <Link href="/operations" className="owner-home__summary-card">
            <span>حالات اليوم</span>
            <strong><bdi>{countFormatter.format(home.today.operationCount)}</bdi></strong>
            <small>عرض الشغل</small>
          </Link>
        )}
        {capabilities.canReviewWork && home.review && (
          <Link href="/accounts/review" className="owner-home__summary-card owner-home__summary-card--review">
            <span>تحتاج مراجعة</span>
            <strong><bdi>{countFormatter.format(home.review.awaitingCount)}</bdi></strong>
            <small>مراجعة الشغل</small>
          </Link>
        )}
        {capabilities.canViewDoctorAccounts && home.doctorAccounts && (
          <Link href="/doctor-accounts" className="owner-home__summary-card">
            <span>حسابات الأطباء</span>
            <strong className="owner-home__summary-action">عرض الأرصدة</strong>
            <small>فتح الحسابات</small>
          </Link>
        )}
      </section>

      {capabilities.canReviewWork && home.review && (
        <section className="owner-home__section owner-home__review" aria-labelledby="owner-review-title">
          <header className="owner-home__section-heading">
            <div>
              <span>تحتاج مراجعة</span>
              <h2 id="owner-review-title">
                {home.review.awaitingCount === 0
                  ? "لا توجد حالات تنتظر المراجعة"
                  : `${countFormatter.format(home.review.awaitingCount)} حالات تنتظر الاعتماد`}
              </h2>
            </div>
            <Link className="owner-home__primary-link" href="/accounts/review">مراجعة الشغل</Link>
          </header>
          {home.review.awaitingOperations.length > 0 && (
            <div className="owner-home__work-list">
              {home.review.awaitingOperations.map((operation) => (
                <Link href="/accounts/review" key={operation.id}>
                  <WorkItem operation={operation} />
                </Link>
              ))}
            </div>
          )}
        </section>
      )}

      {actions.length > 0 && (
        <section className="owner-home__section" aria-labelledby="owner-actions-title">
          <header className="owner-home__section-heading">
            <div>
              <span>إدارة الشركة</span>
              <h2 id="owner-actions-title">إجراءات سريعة</h2>
            </div>
          </header>
          <nav className="owner-home__actions" aria-label="إجراءات الإدارة السريعة">
            {actions.map((action) => (
              <Link href={action.href} key={action.href}>
                <span>
                  <strong>{action.label}</strong>
                  <small>{action.detail}</small>
                </span>
                <b aria-hidden="true">←</b>
              </Link>
            ))}
          </nav>
        </section>
      )}

      <div className="owner-home__columns">
        {capabilities.canViewDoctorAccounts && home.doctorAccounts && (
          <section className="owner-home__section" aria-labelledby="owner-doctors-title">
            <header className="owner-home__section-heading">
              <div>
                <span>المراكز الحالية</span>
                <h2 id="owner-doctors-title">حسابات الأطباء</h2>
              </div>
              <Link href="/doctor-accounts">عرض حسابات الأطباء</Link>
            </header>
            {home.doctorAccounts.accounts.length > 0 ? (
              <div className="owner-home__balances">
                {home.doctorAccounts.accounts.map((account) => {
                  const state = account.balance > 0
                    ? { text: "مستحق على الطبيب", className: "is-debit" }
                    : account.balance < 0
                      ? { text: "رصيد لصالح الطبيب", className: "is-credit" }
                      : { text: "مسوّى", className: "is-settled" };
                  return (
                    <Link href={`/doctor-accounts/${account.doctorId}`} key={account.doctorId}>
                      <span>
                        <strong>{account.doctorName}</strong>
                        <small>{state.text}</small>
                      </span>
                      <b className={state.className}>
                        <bdi>{amountFormatter.format(Math.abs(account.balance))}</bdi> ج.م
                      </b>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <p className="owner-home__empty">لا توجد حسابات أطباء لعرضها</p>
            )}
          </section>
        )}

        {capabilities.canViewOperations && home.recentOperations && (
          <section className="owner-home__section" aria-labelledby="owner-recent-title">
            <header className="owner-home__section-heading">
              <div>
                <span>آخر ما تم تسجيله</span>
                <h2 id="owner-recent-title">الشغل الأخير</h2>
              </div>
              <Link href="/operations">عرض كل الشغل</Link>
            </header>
            {home.recentOperations.length > 0 ? (
              <div className="owner-home__work-list">
                {home.recentOperations.map((operation) => (
                  <Link href={`/operations#${operation.id}`} key={operation.id}>
                    <WorkItem operation={operation} />
                  </Link>
                ))}
              </div>
            ) : (
              <p className="owner-home__empty">لا توجد عمليات حديثة</p>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
