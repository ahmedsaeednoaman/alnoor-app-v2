"use client";

import { FormEvent, useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Swal from "sweetalert2";

import { useDialogScrollLock } from "./use-dialog-scroll-lock";

const subscribeToMount = () => () => {};

function useMounted() {
  return useSyncExternalStore(
    subscribeToMount,
    () => true,
    () => false,
  );
}

type UserStatus = "active" | "suspended" | "blocked";

type RoleRecord = {
  id: string;
  code: string;
  name: string;
  description: string | null;
};

type UserRecord = {
  id: string;
  username: string;
  displayName: string;
  status: UserStatus;

  archivedAt: string | null;

  lastLoginAt: string | null;

  createdAt: string;
  updatedAt: string;

  baseRole: RoleRecord;
};

type UserResponse = {
  user: UserRecord;
};

type PermissionRecord = {
  id: string;
  code: string;
  module: string;
  label: string;
  description: string | null;
};

type CatalogResponse = {
  roles: Array<
    RoleRecord & {
      defaultPermissionIds: string[];
    }
  >;
  permissions: PermissionRecord[];
  modules: Array<{
    module: string;
    permissions: PermissionRecord[];
  }>;
};

type UserPermissionsResponse = {
  user: {
    id: string;
    displayName: string;
    username: string;
    archivedAt: string | null;
    baseRole: Pick<RoleRecord, "id" | "code" | "name">;
  };
  basePermissions: string[];
  grants: string[];
  denies: string[];
  effectivePermissions: string[];
  allowedModules: string[];
};

type ManageUserDialogProps = {
  userId: string;

  canCreateOwner: boolean;

  onClose: () => void;

  onUpdated: () => void | Promise<void>;
};

type FormErrors = {
  displayName?: string;
  username?: string;
  baseRoleId?: string;
};

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function EditIcon() {
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
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
    </svg>
  );
}

function EyeIcon({ visible }: { visible: boolean }) {
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
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
      {!visible && <path d="M4 4 20 20" />}
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

async function loadUser(userId: string) {
  const response = await fetch(`/api/v1/users/${userId}`, {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
  });

  const body = await response.json();

  if (!response.ok) {
    throw new Error(body?.error?.message ?? "تعذر تحميل بيانات المستخدم.");
  }

  return body as UserResponse;
}

async function loadCatalog() {
  const response = await fetch("/api/v1/access/catalog", {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
  });

  const body = await response.json();

  if (!response.ok) {
    throw new Error(body?.error?.message ?? "تعذر تحميل الأدوار.");
  }

  return body as CatalogResponse;
}

async function loadUserPermissions(userId: string) {
  const response = await fetch(`/api/v1/users/${userId}/permissions`, {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
  });

  const body = await response.json();

  if (!response.ok) {
    throw new Error(body?.error?.message ?? "تعذر تحميل صلاحيات المستخدم.");
  }

  return body as UserPermissionsResponse;
}

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

export function ManageUserDialog({
  userId,
  canCreateOwner,
  onClose,
  onUpdated,
}: ManageUserDialogProps) {
  useDialogScrollLock();

  const mounted = useMounted();

  const [user, setUser] = useState<UserRecord | null>(null);
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [userPermissions, setUserPermissions] =
    useState<UserPermissionsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [baseRoleId, setBaseRoleId] = useState("");
  const [status, setStatus] = useState<UserStatus>("active");

  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [savingPermissions, setSavingPermissions] = useState(false);
  const [permissionGrants, setPermissionGrants] = useState<string[]>([]);
  const [permissionDenies, setPermissionDenies] = useState<string[]>([]);

  // حالة إعادة تعيين كلمة المرور
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [userResult, catalogResult, permissionsResult] = await Promise.all([
          loadUser(userId),
          loadCatalog(),
          loadUserPermissions(userId),
        ]);

        if (cancelled) {
          return;
        }

        setUser(userResult.user);
        setCatalog(catalogResult);
        setUserPermissions(permissionsResult);
        setPermissionGrants(permissionsResult.grants);
        setPermissionDenies(permissionsResult.denies);

        setDisplayName(userResult.user.displayName);
        setUsername(userResult.user.username);
        setBaseRoleId(userResult.user.baseRole.id);
        setStatus(userResult.user.status);
      } catch (caught) {
        if (cancelled) {
          return;
        }

        setLoadError(
          caught instanceof Error
            ? caught.message
            : "تعذر تحميل بيانات المستخدم.",
        );
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!mounted) {
    return null;
  }

  const loading = (!user || !catalog || !userPermissions) && !loadError;

  const availableRoles =
    catalog?.roles.filter(
      (role) =>
        canCreateOwner ||
        role.code !== "owner" ||
        role.id === user?.baseRole.id,
    ) ?? [];

  function clearError(field: keyof FormErrors) {
    if (!errors[field]) {
      return;
    }

    setErrors((current) => ({
      ...current,
      [field]: undefined,
    }));
  }

  function setPermissionEnabled(code: string, enabled: boolean) {
    if (!userPermissions) return;

    const inherited = userPermissions.basePermissions.includes(code);

    setPermissionGrants((current) => {
      const next = new Set(current);
      if (!inherited && enabled) next.add(code);
      else next.delete(code);
      return Array.from(next);
    });

    setPermissionDenies((current) => {
      const next = new Set(current);
      if (inherited && !enabled) next.add(code);
      else next.delete(code);
      return Array.from(next);
    });
  }

  async function handlePermissionsSave() {
    if (!user || !userPermissions) return;

    setSavingPermissions(true);

    try {
      const response = await fetch(`/api/v1/users/${user.id}/permissions`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grants: permissionGrants,
          denies: permissionDenies,
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body?.error?.message ?? "تعذر تحديث صلاحيات المستخدم.");
      }

      const updated = body as UserPermissionsResponse;
      setUserPermissions(updated);
      setPermissionGrants(updated.grants);
      setPermissionDenies(updated.denies);

      await Swal.fire({
        icon: "success",
        iconColor: "#48C6D9",
        imageUrl: "/images/Al-Noor Endoscope Medical Logo.png",
        imageAlt: "النور للمناظير الطبية",
        imageWidth: 135,
        title: "تم تحديث الصلاحيات",
        text: "تم تحديث صلاحيات المستخدم بنجاح",
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
        imageWidth: 135,
        title: "تعذر تحديث الصلاحيات",
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
      setSavingPermissions(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!user) {
      return;
    }

    const nextErrors: FormErrors = {};

    const normalizedDisplayName = displayName.trim();
    const normalizedUsername = username.trim().toLowerCase();

    if (normalizedDisplayName.length < 2) {
      nextErrors.displayName = "أدخل الاسم الظاهر.";
    }

    if (normalizedUsername.length < 3) {
      nextErrors.username = "اسم المستخدم يجب أن يكون 3 أحرف على الأقل.";
    } else if (!/^[a-zA-Z0-9._-]+$/.test(normalizedUsername)) {
      nextErrors.username = "استخدم حروف إنجليزية وأرقام و . _ - فقط.";
    }

    if (!baseRoleId) {
      nextErrors.baseRoleId = "اختر الدور الأساسي.";
    }

    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch(`/api/v1/users/${user.id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          displayName: normalizedDisplayName,
          username: normalizedUsername,
          baseRoleId,
          status,
        }),
      });

      const body = await response.json();

      if (!response.ok) {
        if (body?.error?.code === "USERNAME_ALREADY_EXISTS") {
          setErrors((current) => ({
            ...current,
            username: "اسم المستخدم مستخدم بالفعل.",
          }));

          return;
        }

        throw new Error(body?.error?.message ?? "تعذر تعديل المستخدم.");
      }

      await onUpdated();

      onClose();

      await Swal.fire({
        icon: "success",
        iconColor: "#48C6D9",
        imageUrl: "/images/Al-Noor Endoscope Medical Logo.png",
        imageAlt: "النور للمناظير الطبية",
        imageWidth: 135,
        title: "تم تحديث المستخدم",
        text: `تم حفظ بيانات ${normalizedDisplayName} بنجاح.`,
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
        imageWidth: 135,
        title: "تعذر حفظ التعديلات",
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
      setSubmitting(false);
    }
  }

  async function handlePasswordReset() {
    if (!user) {
      return;
    }

    setPasswordError(null);

    if (newPassword.length < 8) {
      setPasswordError("كلمة المرور يجب أن تكون 8 أحرف على الأقل.");
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setPasswordError("كلمتا المرور غير متطابقتين.");
      return;
    }

    const confirmation = await Swal.fire({
      icon: "warning",
      iconColor: "#FBBF24",
      imageUrl: "/images/Al-Noor Endoscope Medical Logo.png",
      imageAlt: "النور للمناظير الطبية",
      imageWidth: 130,
      title: "إعادة تعيين كلمة المرور",
      text: `هل تريد تعيين كلمة مرور جديدة لحساب ${user.displayName}؟`,
      confirmButtonText: "نعم، تغيير كلمة المرور",
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

    if (!confirmation.isConfirmed) {
      return;
    }

    setResettingPassword(true);

    try {
      const response = await fetch(`/api/v1/users/${user.id}/password`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          password: newPassword,
        }),
      });

      const body = await response.json();

      if (!response.ok) {
        throw new Error(
          body?.error?.message ?? "تعذر إعادة تعيين كلمة المرور.",
        );
      }

      setNewPassword("");
      setConfirmNewPassword("");
      setShowNewPassword(false);

      await Swal.fire({
        icon: "success",
        iconColor: "#48C6D9",
        imageUrl: "/images/Al-Noor Endoscope Medical Logo.png",
        imageAlt: "النور للمناظير الطبية",
        imageWidth: 135,
        title: "تم تغيير كلمة المرور",
        text: `تم تعيين كلمة مرور جديدة لحساب ${user.displayName}.`,
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
        imageWidth: 135,
        title: "تعذر تغيير كلمة المرور",
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
      setResettingPassword(false);
    }
  }

  async function handleLifecycle(action: "archive" | "restore" | "delete") {
    if (!user) return;

    const copy = {
      archive: {
        title: "أرشفة الحساب",
        text: "سيتم منع المستخدم من تسجيل الدخول وإخفاؤه من قائمة المستخدمين الحاليين، مع الاحتفاظ بكل السجلات التاريخية المرتبطة به.",
        confirm: "نعم، أرشفة الحساب",
        success: "تمت أرشفة الحساب",
      },
      restore: {
        title: "استعادة الحساب",
        text: "سيعود الحساب إلى قائمة المستخدمين الحاليين، وسيتعين على المستخدم تسجيل الدخول من جديد.",
        confirm: "نعم، استعادة الحساب",
        success: "تمت استعادة الحساب",
      },
      delete: {
        title: "حذف الحساب نهائياً",
        text: "هذا الإجراء نهائي ولا يمكن التراجع عنه. لن يُسمح بالحذف إذا كانت هناك سجلات مرتبطة بالحساب.",
        confirm: "نعم، حذف نهائي",
        success: "تم حذف الحساب نهائياً",
      },
    }[action];

    const confirmation = await Swal.fire({
      icon: "warning",
      iconColor: action === "delete" ? "#FB7185" : "#FBBF24",
      imageUrl: "/images/Al-Noor Endoscope Medical Logo.png",
      imageAlt: "النور للمناظير الطبية",
      imageWidth: 130,
      title: copy.title,
      text: copy.text,
      confirmButtonText: copy.confirm,
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
        confirmButton:
          action === "delete"
            ? "alnoor-alert__button manage-lifecycle-alert__danger"
            : "alnoor-alert__button",
        cancelButton: "alnoor-alert__cancel",
      },
    });

    if (!confirmation.isConfirmed) return;

    setSubmitting(true);

    try {
      const endpoint =
        action === "delete"
          ? `/api/v1/users/${user.id}`
          : `/api/v1/users/${user.id}/${action}`;
      const response = await fetch(endpoint, {
        method: action === "delete" ? "DELETE" : "POST",
        credentials: "same-origin",
      });
      const contentType = response.headers.get("content-type");

      const body = contentType?.includes("application/json")
        ? await response.json()
        : null;

      if (!response.ok) {
        throw new Error(body?.error?.message ?? "تعذر تنفيذ العملية.");
      }

      await onUpdated();
      onClose();

      await Swal.fire({
        icon: "success",
        iconColor: "#48C6D9",
        imageUrl: "/images/Al-Noor Endoscope Medical Logo.png",
        imageAlt: "النور للمناظير الطبية",
        imageWidth: 130,
        title: copy.success,
        confirmButtonText: "تم",
        buttonsStyling: false,
        customClass: {
          popup: "alnoor-alert",
          image: "alnoor-alert__logo",
          icon: "alnoor-alert__icon",
          title: "alnoor-alert__title",
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
        title: "تعذر تنفيذ الإجراء",
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
      setSubmitting(false);
    }
  }

  return createPortal(
    <div className="add-user-dialog" role="presentation">
      <button
        type="button"
        className="add-user-dialog__backdrop"
        onClick={submitting || resettingPassword ? undefined : onClose}
        aria-label="إغلاق"
      />

      <section
        className="add-user-dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="manage-user-title"
      >
        <header className="add-user-dialog__header">
          <div className="add-user-dialog__heading">
            <span className="add-user-dialog__icon">
              <EditIcon />
            </span>

            <div>
              <span>إدارة المستخدمين</span>

              <h2 id="manage-user-title">إدارة الحساب</h2>
            </div>
          </div>

          <button
            type="button"
            className="add-user-dialog__close"
            onClick={onClose}
            disabled={submitting || resettingPassword}
            aria-label="إغلاق"
          >
            <CloseIcon />
          </button>
        </header>

        {loading ? (
          <div className="add-user-dialog__catalog-loading">
            <span className="login-spinner" />

            <p>جارٍ تحميل بيانات المستخدم...</p>
          </div>
        ) : loadError ? (
          <div className="add-user-dialog__catalog-error">
            <strong>تعذر تحميل المستخدم</strong>

            <p>{loadError}</p>

            <button type="button" onClick={onClose}>
              إغلاق
            </button>
          </div>
        ) : user ? (
          <form className="add-user-form" onSubmit={handleSubmit} noValidate>
            <div className="add-user-dialog__body">
              <div className="manage-user-summary">
                <div>
                  <span>تاريخ إنشاء الحساب</span>

                  <strong>{formatDate(user.createdAt)}</strong>
                </div>

                <div>
                  <span>آخر تسجيل دخول</span>

                  <strong>{formatDate(user.lastLoginAt)}</strong>
                </div>
              </div>

              <div className="add-user-form__grid">
                <label className="add-user-field add-user-field--wide">
                  <span>الاسم الظاهر</span>

                  <input
                    type="text"
                    value={displayName}
                    disabled={
                      submitting ||
                      resettingPassword ||
                      Boolean(user.archivedAt)
                    }
                    onChange={(event) => {
                      setDisplayName(event.target.value);

                      clearError("displayName");
                    }}
                  />

                  {errors.displayName && <small>{errors.displayName}</small>}
                </label>

                <label className="add-user-field add-user-field--wide">
                  <span>اسم المستخدم</span>

                  <div className="add-user-username">
                    <span aria-hidden="true">@</span>

                    <input
                      type="text"
                      dir="ltr"
                      value={username}
                      disabled={
                        submitting ||
                        resettingPassword ||
                        Boolean(user.archivedAt)
                      }
                      autoCapitalize="none"
                      spellCheck={false}
                      onChange={(event) => {
                        setUsername(event.target.value);

                        clearError("username");
                      }}
                    />
                  </div>

                  {errors.username && <small>{errors.username}</small>}
                </label>

                <label className="add-user-field">
                  <span>الدور الأساسي</span>

                  <select
                    value={baseRoleId}
                    disabled={
                      submitting ||
                      resettingPassword ||
                      Boolean(user.archivedAt)
                    }
                    onChange={(event) => {
                      setBaseRoleId(event.target.value);

                      clearError("baseRoleId");
                    }}
                  >
                    {availableRoles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </select>

                  {errors.baseRoleId && <small>{errors.baseRoleId}</small>}
                </label>

                <label className="add-user-field">
                  <span>حالة الحساب</span>

                  <select
                    value={status}
                    disabled={
                      submitting ||
                      resettingPassword ||
                      Boolean(user.archivedAt)
                    }
                    onChange={(event) =>
                      setStatus(event.target.value as UserStatus)
                    }
                  >
                    <option value="active">نشط</option>

                    <option value="suspended">موقوف</option>

                    <option value="blocked">محظور</option>
                  </select>
                </label>
              </div>

              {catalog && userPermissions && (
                <section className="manage-permissions">
                  <header className="manage-permissions__header">
                    <div>
                      <strong>الصلاحيات المخصصة</strong>
                      <p>
                        الدور الأساسي هو {userPermissions.user.baseRole.name}.
                        يمكنك إضافة أو منع صلاحيات لهذا المستخدم فقط.
                      </p>
                    </div>
                    <span>{userPermissions.effectivePermissions.length} صلاحية فعالة</span>
                  </header>

                  <div className="manage-permissions__legend" aria-label="دليل حالات الصلاحيات">
                    <span className="manage-permissions__badge manage-permissions__badge--inherited">
                      من الدور الأساسي
                    </span>
                    <span className="manage-permissions__badge manage-permissions__badge--grant">
                      مسموح لهذا المستخدم
                    </span>
                    <span className="manage-permissions__badge manage-permissions__badge--deny">
                      ممنوع لهذا المستخدم
                    </span>
                  </div>

                  <div className="manage-permissions__modules">
                    {catalog.modules.map((module) => (
                      <section className="manage-permissions__module" key={module.module}>
                        <h3>{moduleLabels[module.module] ?? module.module}</h3>

                        <div className="manage-permissions__items">
                          {module.permissions.map((permission) => {
                            const inherited = userPermissions.basePermissions.includes(
                              permission.code,
                            );
                            const granted = permissionGrants.includes(permission.code);
                            const denied = permissionDenies.includes(permission.code);
                            const enabled = denied ? false : inherited || granted;
                            const state = denied
                              ? "deny"
                              : granted
                                ? "grant"
                                : "default";

                            return (
                              <label className="manage-permissions__item" key={permission.id}>
                                <span className="manage-permissions__copy">
                                  <strong>{permission.label}</strong>
                                  <small
                                    className={`manage-permissions__badge manage-permissions__badge--${state}`}
                                  >
                                    {denied
                                      ? "ممنوع لهذا المستخدم"
                                      : granted
                                        ? "مسموح لهذا المستخدم"
                                        : inherited
                                          ? "من الدور الأساسي"
                                          : "غير مسموح من الدور الأساسي"}
                                  </small>
                                </span>

                                <input
                                  type="checkbox"
                                  checked={enabled}
                                  disabled={
                                    Boolean(user.archivedAt) ||
                                    savingPermissions ||
                                    submitting ||
                                    resettingPassword
                                  }
                                  onChange={(event) =>
                                    setPermissionEnabled(
                                      permission.code,
                                      event.target.checked,
                                    )
                                  }
                                />
                                <span className="manage-permissions__switch" aria-hidden="true" />
                              </label>
                            );
                          })}
                        </div>
                      </section>
                    ))}
                  </div>

                  {!user.archivedAt && (
                    <button
                      type="button"
                      className="manage-permissions__save"
                      onClick={() => void handlePermissionsSave()}
                      disabled={savingPermissions || submitting || resettingPassword}
                    >
                      {savingPermissions ? "جارٍ حفظ الصلاحيات..." : "حفظ الصلاحيات"}
                    </button>
                  )}
                </section>
              )}

              {!user.archivedAt && (
                <section className="manage-password">
                  <header className="manage-password__header">
                    <div>
                      <strong>إعادة تعيين كلمة المرور</strong>

                      <p>
                        لن يتم عرض كلمة المرور القديمة أو استرجاعها. سيتم حفظ
                        الكلمة الجديدة كـ Argon2id hash فقط.
                      </p>
                    </div>
                  </header>

                  <div className="manage-password__grid">
                    <label className="add-user-field">
                      <span>كلمة المرور الجديدة</span>

                      <div className="add-user-password">
                        <input
                          type={showNewPassword ? "text" : "password"}
                          value={newPassword}
                          placeholder="8 أحرف على الأقل"
                          autoComplete="new-password"
                          disabled={resettingPassword || submitting}
                          onChange={(event) => {
                            setNewPassword(event.target.value);

                            if (passwordError) {
                              setPasswordError(null);
                            }
                          }}
                        />

                        <button
                          type="button"
                          onClick={() =>
                            setShowNewPassword((current) => !current)
                          }
                          aria-label={
                            showNewPassword
                              ? "إخفاء كلمة المرور"
                              : "إظهار كلمة المرور"
                          }
                        >
                          <EyeIcon visible={showNewPassword} />
                        </button>
                      </div>
                    </label>

                    <label className="add-user-field">
                      <span>تأكيد كلمة المرور</span>

                      <input
                        type={showNewPassword ? "text" : "password"}
                        value={confirmNewPassword}
                        placeholder="أعد كتابة كلمة المرور"
                        autoComplete="new-password"
                        disabled={resettingPassword || submitting}
                        onChange={(event) => {
                          setConfirmNewPassword(event.target.value);

                          if (passwordError) {
                            setPasswordError(null);
                          }
                        }}
                      />
                    </label>
                  </div>

                  {passwordError && (
                    <p className="manage-password__error">{passwordError}</p>
                  )}

                  <button
                    type="button"
                    className="manage-password__submit"
                    onClick={() => {
                      void handlePasswordReset();
                    }}
                    disabled={resettingPassword || submitting}
                  >
                    {resettingPassword
                      ? "جارٍ تغيير كلمة المرور..."
                      : "تعيين كلمة المرور الجديدة"}
                  </button>
                </section>
              )}

              <section className="manage-lifecycle">
                <header>
                  <strong>
                    {user.archivedAt
                      ? "إدارة الحساب المؤرشف"
                      : "دورة حياة الحساب"}
                  </strong>
                  <p>
                    {user.archivedAt
                      ? "تمت أرشفة الحساب في " +
                        formatDate(user.archivedAt) +
                        "."
                      : "يمكن أرشفة الحساب مع الاحتفاظ بسجلاته، أو حذفه نهائياً إذا لم تكن له ارتباطات."}
                  </p>
                </header>
                <div className="manage-lifecycle__actions">
                  {user.archivedAt ? (
                    <button
                      type="button"
                      className="manage-lifecycle__restore"
                      onClick={() => void handleLifecycle("restore")}
                      disabled={submitting}
                    >
                      استعادة الحساب
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="manage-lifecycle__archive"
                      onClick={() => void handleLifecycle("archive")}
                      disabled={submitting}
                    >
                      أرشفة الحساب
                    </button>
                  )}
                  <button
                    type="button"
                    className="manage-lifecycle__delete"
                    onClick={() => void handleLifecycle("delete")}
                    disabled={submitting}
                  >
                    حذف نهائي
                  </button>
                </div>
              </section>
            </div>

            <footer className="add-user-form__actions">
              {user.archivedAt ? (
                <button
                  type="button"
                  className="add-user-form__cancel"
                  onClick={onClose}
                  disabled={submitting}
                >
                  إغلاق
                </button>
              ) : (
                <>
                  {" "}
                  <button
                    type="button"
                    className="add-user-form__cancel"
                    onClick={onClose}
                    disabled={
                      submitting ||
                      resettingPassword ||
                      Boolean(user.archivedAt)
                    }
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    className="add-user-form__submit"
                    disabled={
                      submitting ||
                      resettingPassword ||
                      Boolean(user.archivedAt)
                    }
                  >
                    {submitting ? (
                      <>
                        <span className="login-spinner" />
                        جارٍ الحفظ
                      </>
                    ) : (
                      <>
                        <EditIcon />
                        حفظ التعديلات
                      </>
                    )}
                  </button>
                </>
              )}
            </footer>
          </form>
        ) : null}
      </section>
    </div>,
    document.body,
  );
}
