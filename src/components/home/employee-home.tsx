import Link from "next/link";

import type { HomeData, HomeOperation } from "@/lib/home";

type EmployeeHomeProps = {
  home: HomeData;
};

const operationTypeLabels: Record<HomeOperation["type"], string> = {
  lithotripsy: "تفتيت",
  endoscopy: "مناظير",
  contract: "تعاقد",
};

const dateFormatter = new Intl.DateTimeFormat("ar-EG", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Africa/Cairo",
});

function formatOperationDate(value: string) {
  return dateFormatter.format(new Date(`${value}T12:00:00Z`));
}

function AddIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function OperationsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="3" width="16" height="18" rx="3" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </svg>
  );
}

export function EmployeeHome({ home }: EmployeeHomeProps) {
  const { capabilities, identity } = home;
  const recentOperations = home.recentOperations?.slice(0, 5) ?? [];

  return (
    <div className="employee-home">
      <header className="employee-home__welcome">
        <div>
          <span className="employee-home__identity">
            النور للمناظير الطبية
          </span>
          <p>مرحبًا بك</p>
          <h2>{identity.displayName}</h2>
        </div>
        <span className="employee-home__role">الموظف</span>
      </header>

      {(capabilities.canAddWork || capabilities.canViewOperations) && (
        <section className="employee-home__actions" aria-label="إجراءات العمل">
          {capabilities.canAddWork && (
            <Link
              href="/operations/new"
              className="employee-home__action employee-home__action--primary"
            >
              <span className="employee-home__action-icon">
                <AddIcon />
              </span>
              <span>
                <strong>إضافة شغل</strong>
                <small>تسجيل عملية جديدة</small>
              </span>
            </Link>
          )}

          {capabilities.canViewOperations && (
            <Link
              href="/operations"
              className="employee-home__action employee-home__action--secondary"
            >
              <span className="employee-home__action-icon">
                <OperationsIcon />
              </span>
              <span>
                <strong>عرض الشغل</strong>
                <small>فتح سجل العمليات</small>
              </span>
            </Link>
          )}
        </section>
      )}

      {capabilities.canViewOperations && (
        <section className="employee-home__recent" aria-labelledby="recent-work-title">
          <header className="employee-home__section-heading">
            <div>
              <span>سجل العمل</span>
              <h3 id="recent-work-title">الشغل المسجل حديثًا</h3>
            </div>
            {recentOperations.length > 0 && (
              <Link href="/operations">عرض الكل</Link>
            )}
          </header>

          {recentOperations.length > 0 ? (
            <div className="employee-home__operation-list">
              {recentOperations.map((operation) => (
                <article
                  className="employee-home__operation-card"
                  key={operation.id}
                >
                  <div className="employee-home__operation-topline">
                    <span className="employee-home__operation-type">
                      {operationTypeLabels[operation.type]}
                    </span>
                    <span
                      className={
                        operation.canEdit
                          ? "employee-home__edit-state employee-home__edit-state--available"
                          : "employee-home__edit-state"
                      }
                    >
                      <i aria-hidden="true" />
                      {operation.canEdit ? "متاح للتعديل" : "للقراءة فقط"}
                    </span>
                  </div>

                  <div className="employee-home__operation-copy">
                    <h4>{operation.caseName.trim() || "بدون اسم حالة"}</h4>
                    <p>
                      {[operation.doctorName, operation.hospitalName]
                        .filter(Boolean)
                        .join(" • ") || "لا توجد جهة مسجلة"}
                    </p>
                  </div>

                  <footer>
                    <span>
                      {formatOperationDate(operation.date)}
                      <bdi>{` — ${operation.time}`}</bdi>
                    </span>
                    {operation.canEdit && (
                      <Link href={`/operations/${operation.id}/edit`}>
                        تعديل الشغل
                      </Link>
                    )}
                  </footer>
                </article>
              ))}
            </div>
          ) : (
            <div className="employee-home__empty">
              <span aria-hidden="true">
                <OperationsIcon />
              </span>
              <h4>لا يوجد شغل مسجل حديثًا</h4>
              <p>ابدأ بتسجيل أول عملية لتظهر هنا ضمن شغلك الأخير.</p>
              {capabilities.canAddWork && (
                <Link href="/operations/new">إضافة شغل جديد</Link>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
