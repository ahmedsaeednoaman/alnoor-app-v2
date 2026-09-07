"use client";

import { useEffect, useState } from "react";
import { AddUserDialog } from "./add-user-dialog";
import { ManageUserDialog } from "./manage-user-dialog";

type UserStatus = "active" | "suspended" | "blocked";

type UserRecord = {
  id: string;
  username: string;
  displayName: string;
  status: UserStatus;

  archivedAt: string | null;

  lastLoginAt: string | null;

  createdAt: string;
  updatedAt: string;

  baseRole: {
    id: string;
    code: string;
    name: string;
  };
};

type UsersResponse = {
  users: UserRecord[];

  meta: {
    count: number;
  };
};

type UsersListProps = {
  canManage: boolean;
  canCreateOwner: boolean;
};

function UsersIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21h-4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14v-4a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3h4a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9A1.7 1.7 0 0 0 21 10v4a1.7 1.7 0 0 0-1.6 1Z" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5" />
      <path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5" />
    </svg>
  );
}

function formatDate(value: string | null) {
  if (!value) {
    return "لم يسجل الدخول بعد";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function getStatusLabel(status: UserStatus) {
  switch (status) {
    case "active":
      return "نشط";
    case "suspended":
      return "موقوف";
    case "blocked":
      return "محظور";
  }
}

function UserAvatar({ displayName }: { displayName: string }) {
  const initial = displayName.trim().charAt(0) || "م";

  return (
    <span className="users-user-avatar" aria-hidden="true">
      {initial}
    </span>
  );
}

function LoadingState() {
  return (
    <div className="users-loading" aria-label="جارٍ تحميل المستخدمين">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="users-loading__row">
          <span />
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}

async function fetchUsers(tab: "current" | "archived") {
  const endpoint =
    tab === "archived" ? "/api/v1/users?tab=archived" : "/api/v1/users";

  const response = await fetch(endpoint, {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body?.error?.message ?? "تعذر تحميل المستخدمين.");
  }

  return {
    users: Array.isArray(body.users) ? body.users : [],
    meta: { count: Number(body.meta?.count ?? body.users?.length ?? 0) },
  } as UsersResponse;
}

export function UsersList({ canManage, canCreateOwner }: UsersListProps) {
  const [data, setData] = useState<UsersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [tab, setTab] = useState<"current" | "archived">("current");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialUsers() {
      try {
        const result = await fetchUsers(tab);

        if (cancelled) {
          return;
        }

        setData(result);
        setError(null);
      } catch (caught) {
        if (cancelled) {
          return;
        }

        setError(
          caught instanceof Error ? caught.message : "تعذر تحميل المستخدمين.",
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadInitialUsers();

    return () => {
      cancelled = true;
    };
  }, [tab]);

  async function handleRefresh() {
    setLoading(true);
    setError(null);

    try {
      const result = await fetchUsers(tab);

      setData(result);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "تعذر تحميل المستخدمين.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="users-page">
      <section className="users-page__hero">
        <div className="users-page__hero-copy">
          <span className="users-page__hero-icon">
            <UsersIcon />
          </span>

          <div>
            <span className="users-page__eyebrow">إعدادات النظام</span>

            <h2>إدارة المستخدمين</h2>

            <p>
              إدارة حسابات المستخدمين والأدوار والصلاحيات التي يمكن لكل حساب
              الوصول إليها.
            </p>
          </div>
        </div>

        <div className="users-page__hero-actions">
          <div className="users-page__count">
            <strong>{data?.meta.count ?? "—"}</strong>

            <span>مستخدم</span>
          </div>

          {canManage && (
            <button
              type="button"
              className="users-page__add"
              onClick={() => setAddUserOpen(true)}
            >
              <PlusIcon />

              <span>إضافة مستخدم</span>
            </button>
          )}
        </div>
      </section>

      <div className="users-tabs" role="tablist" aria-label="تصنيف المستخدمين">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "current"}
          className={
            tab === "current"
              ? "users-tabs__button users-tabs__button--active"
              : "users-tabs__button"
          }
          onClick={() => setTab("current")}
        >
          المستخدمون الحاليون
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "archived"}
          className={
            tab === "archived"
              ? "users-tabs__button users-tabs__button--active"
              : "users-tabs__button"
          }
          onClick={() => setTab("archived")}
        >
          المؤرشفون
        </button>
      </div>

      <section className="users-panel">
        <header className="users-panel__header">
          <div>
            <h3>حسابات النظام</h3>

            <p>الحسابات المسجلة في قاعدة البيانات.</p>
          </div>

          <button
            type="button"
            className="users-panel__refresh"
            onClick={() => {
              void handleRefresh();
            }}
            disabled={loading}
            aria-label="تحديث قائمة المستخدمين"
          >
            <RefreshIcon />

            <span>تحديث</span>
          </button>
        </header>

        {loading ? (
          <LoadingState />
        ) : error ? (
          <div className="users-state users-state--error">
            <div className="users-state__icon">!</div>

            <h3>تعذر تحميل المستخدمين</h3>

            <p>{error}</p>

            <button
              type="button"
              onClick={() => {
                void handleRefresh();
              }}
            >
              إعادة المحاولة
            </button>
          </div>
        ) : !data || data.users.length === 0 ? (
          <div className="users-state">
            <div className="users-state__icon">
              <UsersIcon />
            </div>

            <h3>لا يوجد مستخدمون</h3>

            <p>لم يتم إنشاء أي حسابات حتى الآن.</p>
          </div>
        ) : (
          <>
            <div className="users-table-wrap">
              <table className="users-table">
                <thead>
                  <tr>
                    <th>المستخدم</th>

                    <th>الدور الأساسي</th>

                    <th>الحالة</th>

                    <th>آخر دخول</th>

                    <th>الإجراءات</th>
                  </tr>
                </thead>

                <tbody>
                  {data.users.map((user) => (
                    <tr key={user.id}>
                      <td>
                        <div className="users-user">
                          <UserAvatar displayName={user.displayName} />

                          <div>
                            <strong>{user.displayName}</strong>

                            <span dir="ltr">@{user.username}</span>
                          </div>
                        </div>
                      </td>

                      <td>
                        <span className="users-role">{user.baseRole.name}</span>
                      </td>

                      <td>
                        <span
                          className={
                            "users-status users-status--" +
                            (user.archivedAt ? "archived" : user.status)
                          }
                        >
                          <i aria-hidden="true" />

                          {user.archivedAt
                            ? "مؤرشف"
                            : getStatusLabel(user.status)}
                        </span>
                      </td>

                      <td>
                        <span className="users-last-login">
                          {formatDate(user.archivedAt ?? user.lastLoginAt)}
                        </span>
                      </td>

                      <td>
                        {canManage ? (
                          <button
                            type="button"
                            className="users-manage-button"
                            onClick={() => setSelectedUserId(user.id)}
                          >
                            <SettingsIcon />

                            <span>إدارة</span>
                          </button>
                        ) : (
                          <span className="users-readonly">عرض فقط</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="users-mobile-list">
              {data.users.map((user) => (
                <article key={user.id} className="users-mobile-card">
                  <header className="users-mobile-card__header">
                    <div className="users-user">
                      <UserAvatar displayName={user.displayName} />

                      <div>
                        <strong>{user.displayName}</strong>

                        <span dir="ltr">@{user.username}</span>
                      </div>
                    </div>

                    <span
                      className={
                        "users-status users-status--" +
                        (user.archivedAt ? "archived" : user.status)
                      }
                    >
                      <i aria-hidden="true" />

                      {user.archivedAt ? "مؤرشف" : getStatusLabel(user.status)}
                    </span>
                  </header>

                  <div className="users-mobile-card__details">
                    <div>
                      <span>الدور الأساسي</span>

                      <strong>{user.baseRole.name}</strong>
                    </div>

                    <div>
                      <span>آخر دخول</span>

                      <strong>
                        {formatDate(user.archivedAt ?? user.lastLoginAt)}
                      </strong>
                    </div>
                  </div>

                  {canManage && (
                    <button
                      type="button"
                      className="users-manage-button users-manage-button--mobile"
                      onClick={() => setSelectedUserId(user.id)}
                    >
                      <SettingsIcon />
                      إدارة المستخدم
                    </button>
                  )}
                </article>
              ))}
            </div>
          </>
        )}
      </section>

      <AddUserDialog
        open={addUserOpen}
        canCreateOwner={canCreateOwner}
        onClose={() => setAddUserOpen(false)}
        onCreated={handleRefresh}
      />

      {selectedUserId && (
        <ManageUserDialog
          key={selectedUserId}
          userId={selectedUserId}
          canCreateOwner={canCreateOwner}
          onClose={() => setSelectedUserId(null)}
          onUpdated={handleRefresh}
        />
      )}
    </div>
  );
}
