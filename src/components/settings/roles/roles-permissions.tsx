"use client";

import { useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";

type PermissionRecord = {
  id: string;
  code: string;
  module: string;
  label: string;
  description: string | null;
};

type RoleRecord = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  defaultPermissionIds: string[];
};

type CatalogResponse = {
  roles: RoleRecord[];
  permissions: PermissionRecord[];
  modules: Array<{
    module: string;
    permissions: PermissionRecord[];
  }>;
  meta: {
    roleCount: number;
    permissionCount: number;
  };
};

type RolesPermissionsProps = {
  canManage: boolean;
};

const moduleLabels: Record<string, string> = {
  dashboard: "الصفحة الرئيسية",
  operations: "العمليات",
  expenses: "المصروفات",
  accounting: "الحسابات",
  doctor_accounts: "حسابات الأطباء",
  printing: "الطباعة",
  reports: "التقارير",
  salaries: "المرتبات",
  users: "المستخدمون",
  settings: "الإعدادات",
  catalogs: "القوائم الأساسية",
};

function RolesIcon() {
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
      <path d="M12 3 4 7v5c0 4.8 3.2 7.8 8 9 4.8-1.2 8-4.2 8-9V7Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

async function loadCatalog() {
  const response = await fetch("/api/v1/access/catalog", {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
  });
  const body = await response.json();

  if (!response.ok) {
    throw new Error(body?.error?.message ?? "تعذر تحميل الأدوار والصلاحيات.");
  }

  return body as CatalogResponse;
}

export function RolesPermissions({ canManage }: RolesPermissionsProps) {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [selectedPermissionIds, setSelectedPermissionIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const result = await loadCatalog();
        if (cancelled) return;

        const initialRole =
          result.roles.find((role) => role.code === "owner") ?? result.roles[0];

        setCatalog(result);
        setSelectedRoleId(initialRole?.id ?? "");
        setSelectedPermissionIds(initialRole?.defaultPermissionIds ?? []);
        setError(null);
      } catch (caught) {
        if (cancelled) return;
        setError(
          caught instanceof Error
            ? caught.message
            : "تعذر تحميل الأدوار والصلاحيات.",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedRole =
    catalog?.roles.find((role) => role.id === selectedRoleId) ?? null;

  const selectedModules = useMemo(() => {
    if (!catalog) return 0;

    const permissionIds = new Set(selectedPermissionIds);
    return new Set(
      catalog.permissions
        .filter((permission) => permissionIds.has(permission.id))
        .map((permission) => permission.module),
    ).size;
  }, [catalog, selectedPermissionIds]);

  const isOwnerRole = selectedRole?.code === "owner";
  const canEditSelectedRole = canManage && !isOwnerRole;
  const hasChanges = Boolean(
    selectedRole &&
      (selectedPermissionIds.length !== selectedRole.defaultPermissionIds.length ||
        selectedPermissionIds.some(
          (permissionId) =>
            !selectedRole.defaultPermissionIds.includes(permissionId),
        )),
  );

  function selectRole(role: RoleRecord) {
    if (saving) return;
    setSelectedRoleId(role.id);
    setSelectedPermissionIds(role.defaultPermissionIds);
  }

  function togglePermission(permissionId: string, enabled: boolean) {
    setSelectedPermissionIds((current) => {
      const next = new Set(current);
      if (enabled) next.add(permissionId);
      else next.delete(permissionId);
      return Array.from(next);
    });
  }

  async function handleSave() {
    if (!selectedRole || !canEditSelectedRole || !hasChanges) return;

    const confirmation = await Swal.fire({
      icon: "warning",
      iconColor: "#FBBF24",
      imageUrl: "/images/Al-Noor Endoscope Medical Logo.png",
      imageAlt: "النور للمناظير الطبية",
      imageWidth: 130,
      title: "تحديث صلاحيات الدور",
      text: "سيؤثر تعديل صلاحيات هذا الدور على جميع المستخدمين الذين يعتمدون عليه كدور أساسي. ستظل الصلاحيات المخصصة لكل مستخدم محفوظة.",
      confirmButtonText: "نعم، حفظ الصلاحيات",
      cancelButtonText: "إلغاء",
      showCancelButton: true,
      reverseButtons: true,
      buttonsStyling: false,
      customClass: {
        popup: "alnoor-alert",
        image: "alnoor-alert__logo",
        icon: "alnoor-alert__icon",
        title: "alnoor-alert__title",
        htmlContainer: "alnoor-alert__text",
        confirmButton: "alnoor-alert__button",
        cancelButton: "alnoor-alert__cancel",
      },
    });

    if (!confirmation.isConfirmed) return;

    setSaving(true);

    try {
      const response = await fetch(
        `/api/v1/access/roles/${selectedRole.id}/permissions`,
        {
          method: "PUT",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ permissionIds: selectedPermissionIds }),
        },
      );
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body?.error?.message ?? "تعذر تحديث صلاحيات الدور.");
      }

      setCatalog((current) =>
        current
          ? {
              ...current,
              roles: current.roles.map((role) =>
                role.id === selectedRole.id
                  ? { ...role, defaultPermissionIds: selectedPermissionIds }
                  : role,
              ),
            }
          : current,
      );

      await Swal.fire({
        icon: "success",
        iconColor: "#48C6D9",
        imageUrl: "/images/Al-Noor Endoscope Medical Logo.png",
        imageAlt: "النور للمناظير الطبية",
        imageWidth: 130,
        title: "تم تحديث صلاحيات الدور",
        text: `تم حفظ الصلاحيات الافتراضية لدور ${selectedRole.name} بنجاح.`,
        confirmButtonText: "تم",
        buttonsStyling: false,
        customClass: {
          popup: "alnoor-alert",
          image: "alnoor-alert__logo",
          icon: "alnoor-alert__icon",
          title: "alnoor-alert__title",
          htmlContainer: "alnoor-alert__text",
          confirmButton: "alnoor-alert__button",
        },
      });
    } catch (caught) {
      await Swal.fire({
        icon: "error",
        iconColor: "#FB7185",
        imageUrl: "/images/Al-Noor Endoscope Medical Logo.png",
        imageAlt: "النور للمناظير الطبية",
        imageWidth: 130,
        title: "تعذر حفظ الصلاحيات",
        text: caught instanceof Error ? caught.message : "حدث خطأ غير متوقع.",
        confirmButtonText: "حسناً",
        buttonsStyling: false,
        customClass: {
          popup: "alnoor-alert",
          image: "alnoor-alert__logo",
          icon: "alnoor-alert__icon",
          title: "alnoor-alert__title",
          htmlContainer: "alnoor-alert__text",
          confirmButton: "alnoor-alert__button",
        },
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="roles-page roles-page--state">
        <span className="login-spinner" />
        <p>جارٍ تحميل الأدوار والصلاحيات...</p>
      </div>
    );
  }

  if (error || !catalog) {
    return (
      <div className="roles-page roles-page--state roles-page--error">
        <strong>تعذر تحميل الأدوار والصلاحيات</strong>
        <p>{error}</p>
        <button type="button" onClick={() => window.location.reload()}>
          إعادة المحاولة
        </button>
      </div>
    );
  }

  return (
    <div className="users-page roles-page">
      <section className="users-page__hero">
        <div className="users-page__hero-copy">
          <span className="users-page__hero-icon">
            <RolesIcon />
          </span>
          <div>
            <span className="users-page__eyebrow">إعدادات النظام</span>
            <h2>الأدوار والصلاحيات</h2>
            <p>
              إدارة الصلاحيات الافتراضية للأدوار الأساسية مع بقاء صلاحيات كل
              مستخدم المخصصة مستقلة ومحفوظة.
            </p>
          </div>
        </div>
        <div className="users-page__hero-actions">
          <div className="users-page__count">
            <strong>{catalog.meta.roleCount}</strong>
            <span>أدوار</span>
          </div>
        </div>
      </section>

      <div className="roles-layout">
        <aside className="roles-list" aria-label="الأدوار الأساسية">
          <header>
            <h3>الأدوار الأساسية</h3>
            <p>اختر دوراً لعرض صلاحياته الافتراضية.</p>
          </header>

          <div className="roles-list__items">
            {catalog.roles.map((role) => {
              const permissionIds = new Set(role.defaultPermissionIds);
              const moduleCount = new Set(
                catalog.permissions
                  .filter((permission) => permissionIds.has(permission.id))
                  .map((permission) => permission.module),
              ).size;

              return (
                <button
                  type="button"
                  key={role.id}
                  className={
                    role.id === selectedRoleId
                      ? "roles-card roles-card--active"
                      : "roles-card"
                  }
                  onClick={() => selectRole(role)}
                  aria-pressed={role.id === selectedRoleId}
                >
                  <span className="roles-card__topline">
                    <strong>{role.name}</strong>
                    {role.code === "owner" && <i>محمي</i>}
                  </span>
                  <span className="roles-card__code" dir="ltr">
                    {role.code}
                  </span>
                  <span className="roles-card__description">
                    {role.description ?? "دور أساسي للنظام"}
                  </span>
                  <span className="roles-card__stats">
                    <b>{role.defaultPermissionIds.length} صلاحية</b>
                    <b>{moduleCount} وحدات</b>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="roles-matrix-panel">
          {selectedRole ? (
            <>
              <header className="roles-matrix-panel__header">
                <div>
                  <span>الصلاحيات الافتراضية للدور</span>
                  <h3>{selectedRole.name}</h3>
                  <p>
                    كل مستخدم يعتمد على هذا الدور يرث هذه الصلاحيات، ثم تُطبق
                    صلاحياته المخصصة بصورة مستقلة.
                  </p>
                </div>
                <div className="roles-matrix-panel__summary">
                  <strong>{selectedPermissionIds.length}</strong>
                  <span>صلاحية في {selectedModules} وحدات</span>
                </div>
              </header>

              {isOwnerRole && (
                <div className="roles-owner-lock">
                  <strong>دور المالك محمي</strong>
                  <p>
                    يمكنك مراجعة صلاحيات المالك، لكن تعديلها مغلق لمنع فقدان
                    الوصول إلى إدارة النظام والمستخدمين.
                  </p>
                </div>
              )}

              {!canManage && !isOwnerRole && (
                <div className="roles-readonly-note">
                  لديك صلاحية العرض فقط. تعديل الأدوار متاح للمالك المخول.
                </div>
              )}

              <div className="roles-permission-groups">
                {catalog.modules.map((module) => (
                  <section className="roles-permission-group" key={module.module}>
                    <header>
                      <h4>{moduleLabels[module.module] ?? module.module}</h4>
                      <span>
                        {
                          module.permissions.filter((permission) =>
                            selectedPermissionIds.includes(permission.id),
                          ).length
                        }
                        /{module.permissions.length}
                      </span>
                    </header>

                    <div className="roles-permission-group__items">
                      {module.permissions.map((permission) => (
                        <label
                          className="roles-permission-item"
                          key={permission.id}
                        >
                          <span>
                            <strong>{permission.label}</strong>
                            {permission.description && (
                              <small>{permission.description}</small>
                            )}
                          </span>
                          <input
                            type="checkbox"
                            checked={selectedPermissionIds.includes(permission.id)}
                            disabled={!canEditSelectedRole || saving}
                            onChange={(event) =>
                              togglePermission(permission.id, event.target.checked)
                            }
                          />
                          <i aria-hidden="true" />
                        </label>
                      ))}
                    </div>
                  </section>
                ))}
              </div>

              <footer className="roles-matrix-panel__actions">
                <span>
                  الصلاحيات المخصصة للمستخدمين لن تتغير عند حفظ هذا الدور.
                </span>
                {canEditSelectedRole && (
                  <button
                    type="button"
                    disabled={!hasChanges || saving}
                    onClick={() => void handleSave()}
                  >
                    {saving ? "جارٍ الحفظ..." : "حفظ صلاحيات الدور"}
                  </button>
                )}
              </footer>
            </>
          ) : (
            <div className="roles-page--state">لا توجد أدوار متاحة.</div>
          )}
        </section>
      </div>
    </div>
  );
}
