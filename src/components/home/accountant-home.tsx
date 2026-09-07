import Link from "next/link";

import type { HomeData, HomeOperation, HomeReviewItem } from "@/lib/home";

const typeLabels: Record<HomeOperation["type"], string> = {
  lithotripsy: "تفتيت",
  endoscopy: "مناظير",
  contract: "تعاقد",
};

const money = new Intl.NumberFormat("ar-EG", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function OperationIdentity({ operation }: { operation: HomeReviewItem }) {
  const context = [operation.doctorName, operation.hospitalName]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <div className="accountant-home__item-heading">
        <span>{typeLabels[operation.type]}</span>
        <time dateTime={`${operation.date}T${operation.time}`}>
          {operation.date} · <bdi>{operation.time}</bdi>
        </time>
      </div>
      <strong>{operation.caseName || "بدون اسم حالة"}</strong>
      {context && <small>{context}</small>}
    </>
  );
}

export function AccountantHome({ data }: { data: HomeData }) {
  const { capabilities } = data;
  const quickActions = [
    capabilities.canReviewWork
      ? { href: "/accounts/review", label: "مراجعة الشغل", detail: "الحالات المالية" }
      : null,
    capabilities.canViewDoctorAccounts
      ? { href: "/doctor-accounts", label: "حسابات الأطباء", detail: "الأرصدة والحركات" }
      : null,
    capabilities.canViewOperations
      ? { href: "/operations", label: "عرض الشغل", detail: "العمليات المسجلة" }
      : null,
    capabilities.canViewReports
      ? { href: "/reports", label: "التقارير", detail: "التقارير المتاحة" }
      : null,
    capabilities.canUsePrinting
      ? { href: "/print", label: "الطباعة", detail: "مركز الطباعة" }
      : null,
  ].filter((action): action is NonNullable<typeof action> => action !== null);

  return (
    <main className="accountant-home">
      <header className="accountant-home__greeting">
        <div>
          <p>أهلاً،</p>
          <h1>{data.identity.displayName}</h1>
        </div>
        <span>المحاسب</span>
      </header>

      {capabilities.canReviewWork && data.review && (
        <section className="accountant-home__section accountant-home__review" aria-labelledby="accountant-review-title">
          <header className="accountant-home__section-heading">
            <div>
              <p>تحتاج مراجعتك</p>
              <h2 id="accountant-review-title">
                {data.review.awaitingCount === 0
                  ? "لا توجد حالات تنتظر المراجعة"
                  : `${data.review.awaitingCount.toLocaleString("ar-EG")} حالات`}
              </h2>
            </div>
            <Link className="accountant-home__primary-link" href="/accounts/review">
              مراجعة الشغل
            </Link>
          </header>

          {data.review.awaitingOperations.length > 0 && (
            <div className="accountant-home__list">
              {data.review.awaitingOperations.map((operation) => (
                <Link href="/accounts/review" className="accountant-home__item" key={operation.id}>
                  <OperationIdentity operation={operation} />
                </Link>
              ))}
            </div>
          )}
        </section>
      )}

      {quickActions.length > 0 && (
        <section className="accountant-home__section" aria-labelledby="accountant-actions-title">
          <header className="accountant-home__section-heading">
            <div>
              <p>وصول مباشر</p>
              <h2 id="accountant-actions-title">إجراءات سريعة</h2>
            </div>
          </header>
          <nav className="accountant-home__actions" aria-label="إجراءات المحاسب السريعة">
            {quickActions.map((action) => (
              <Link href={action.href} key={action.href}>
                <strong>{action.label}</strong>
                <small>{action.detail}</small>
                <span aria-hidden="true">←</span>
              </Link>
            ))}
          </nav>
        </section>
      )}

      <div className="accountant-home__columns">
        {capabilities.canViewDoctorAccounts && data.doctorAccounts && (
          <section className="accountant-home__section" aria-labelledby="accountant-doctors-title">
            <header className="accountant-home__section-heading">
              <div>
                <p>ملخص محايد</p>
                <h2 id="accountant-doctors-title">حسابات الأطباء</h2>
              </div>
              <Link href="/doctor-accounts">عرض الكل</Link>
            </header>
            {data.doctorAccounts.accounts.length === 0 ? (
              <p className="accountant-home__empty">لا توجد حسابات أطباء لعرضها</p>
            ) : (
              <div className="accountant-home__list">
                {data.doctorAccounts.accounts.map((account) => {
                  const state = account.balance > 0
                    ? { label: "مستحق على الطبيب", className: "is-debit" }
                    : account.balance < 0
                      ? { label: "رصيد لصالح الطبيب", className: "is-credit" }
                      : { label: "مسوّى", className: "is-settled" };
                  return (
                    <Link className="accountant-home__balance" href={`/doctor-accounts/${account.doctorId}`} key={account.doctorId}>
                      <span>
                        <strong>{account.doctorName}</strong>
                        <small>{state.label}</small>
                      </span>
                      <b className={state.className}>
                        <bdi>{money.format(Math.abs(account.balance))}</bdi> ج.م
                      </b>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {capabilities.canViewOperations && data.recentOperations && (
          <section className="accountant-home__section" aria-labelledby="accountant-recent-title">
            <header className="accountant-home__section-heading">
              <div>
                <p>آخر ما تم تسجيله</p>
                <h2 id="accountant-recent-title">الشغل الأخير</h2>
              </div>
              <Link href="/operations">عرض الشغل</Link>
            </header>
            {data.recentOperations.length === 0 ? (
              <p className="accountant-home__empty">لا توجد عمليات حديثة</p>
            ) : (
              <div className="accountant-home__list">
                {data.recentOperations.map((operation) => (
                  <Link href={`/operations#${operation.id}`} className="accountant-home__item" key={operation.id}>
                    <OperationIdentity operation={operation} />
                  </Link>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
