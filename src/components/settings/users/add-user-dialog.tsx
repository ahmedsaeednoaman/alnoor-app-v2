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

  defaultPermissionIds: string[];
};

type AccessCatalogResponse = {
  roles: RoleRecord[];

  meta: {
    roleCount: number;
    permissionCount: number;
  };
};

type AddUserDialogProps = {
  open: boolean;
  canCreateOwner: boolean;

  onClose: () => void;

  onCreated: () => void | Promise<void>;
};

type FormErrors = {
  displayName?: string;
  username?: string;
  password?: string;
  confirmPassword?: string;
  baseRoleId?: string;
  status?: string;
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

function UserPlusIcon() {
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
      <path d="M15 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />

      <circle cx="8" cy="7" r="4" />

      <path d="M19 8v6" />
      <path d="M16 11h6" />
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

async function fetchCatalog() {
  const response = await fetch("/api/v1/access/catalog", {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
  });

  const body = await response.json();

  if (!response.ok) {
    throw new Error(body?.error?.message ?? "تعذر تحميل الأدوار.");
  }

  return body as AccessCatalogResponse;
}

export function AddUserDialog({
  open,
  canCreateOwner,
  onClose,
  onCreated,
}: AddUserDialogProps) {
  useDialogScrollLock(open);

  const mounted = useMounted();

  const [catalog, setCatalog] = useState<AccessCatalogResponse | null>(null);

  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState("");

  const [username, setUsername] = useState("");

  const [password, setPassword] = useState("");

  const [confirmPassword, setConfirmPassword] = useState("");

  const [baseRoleId, setBaseRoleId] = useState("");

  const [status, setStatus] = useState<UserStatus>("active");

  const [showPassword, setShowPassword] = useState(false);

  const [submitting, setSubmitting] = useState(false);

  const [errors, setErrors] = useState<FormErrors>({});

  /*
   * تحميل الأدوار عند أول فتح فقط.
   *
   * لا يوجد setState متزامن
   * قبل await، لذلك لا نعيد
   * مشكلة الـLinter السابقة.
   */
  useEffect(() => {
    if (!open || catalog) {
      return;
    }

    let cancelled = false;

    async function loadCatalog() {
      try {
        const result = await fetchCatalog();

        if (cancelled) {
          return;
        }

        setCatalog(result);

        setCatalogError(null);
      } catch (caught) {
        if (cancelled) {
          return;
        }

        setCatalogError(
          caught instanceof Error ? caught.message : "تعذر تحميل الأدوار.",
        );
      }
    }

    void loadCatalog();

    return () => {
      cancelled = true;
    };
  }, [open, catalog]);

  if (!open || !mounted) {
    return null;
  }

  const availableRoles =
    catalog?.roles.filter((role) => canCreateOwner || role.code !== "owner") ??
    [];

  const catalogLoading = !catalog && !catalogError;

  function clearError(field: keyof FormErrors) {
    if (!errors[field]) {
      return;
    }

    setErrors((current) => ({
      ...current,
      [field]: undefined,
    }));
  }

  function resetForm() {
    setDisplayName("");
    setUsername("");
    setPassword("");
    setConfirmPassword("");
    setBaseRoleId("");
    setStatus("active");
    setShowPassword(false);
    setErrors({});
  }

  function handleClose() {
    if (submitting) {
      return;
    }

    resetForm();
    onClose();
  }

  async function handleRetryCatalog() {
    setCatalogError(null);

    try {
      const result = await fetchCatalog();

      setCatalog(result);
    } catch (caught) {
      setCatalogError(
        caught instanceof Error ? caught.message : "تعذر تحميل الأدوار.",
      );
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors: FormErrors = {};

    const normalizedDisplayName = displayName.trim();

    const normalizedUsername = username.trim().toLowerCase();

    if (normalizedDisplayName.length < 2) {
      nextErrors.displayName = "أدخل اسم المستخدم الظاهر.";
    }

    if (normalizedUsername.length < 3) {
      nextErrors.username = "اسم المستخدم يجب أن يكون 3 أحرف على الأقل.";
    } else if (!/^[a-zA-Z0-9._-]+$/.test(normalizedUsername)) {
      nextErrors.username = "استخدم حروف إنجليزية وأرقام و . _ - فقط.";
    }

    if (password.length < 8) {
      nextErrors.password = "كلمة المرور يجب أن تكون 8 أحرف على الأقل.";
    }

    if (confirmPassword !== password) {
      nextErrors.confirmPassword = "كلمتا المرور غير متطابقتين.";
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
      const response = await fetch("/api/v1/users", {
        method: "POST",

        credentials: "same-origin",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          displayName: normalizedDisplayName,

          username: normalizedUsername,

          password,

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

        throw new Error(body?.error?.message ?? "تعذر إنشاء المستخدم.");
      }

      resetForm();
      onClose();

      await onCreated();

      await Swal.fire({
        icon: "success",

        iconColor: "#48C6D9",

        imageUrl: "/images/Al-Noor Endoscope Medical Logo.png",

        imageAlt: "النور للمناظير الطبية",

        imageWidth: 135,

        title: "تم إنشاء المستخدم",

        text: `تم إنشاء حساب ${normalizedDisplayName} بنجاح.`,

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

        title: "تعذر إنشاء المستخدم",

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
        onClick={handleClose}
        aria-label="إغلاق"
      />

      <section
        className="add-user-dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-user-title"
      >
        <header className="add-user-dialog__header">
          <div className="add-user-dialog__heading">
            <span className="add-user-dialog__icon">
              <UserPlusIcon />
            </span>

            <div>
              <span>إدارة المستخدمين</span>

              <h2 id="add-user-title">إضافة مستخدم جديد</h2>
            </div>
          </div>

          <button
            type="button"
            className="add-user-dialog__close"
            onClick={handleClose}
            disabled={submitting}
            aria-label="إغلاق"
          >
            <CloseIcon />
          </button>
        </header>

        {catalogLoading ? (
          <div className="add-user-dialog__catalog-loading">
            <span className="login-spinner" />

            <p>جارٍ تحميل إعدادات الحساب...</p>
          </div>
        ) : catalogError ? (
          <div className="add-user-dialog__catalog-error">
            <strong>تعذر تحميل الأدوار</strong>

            <p>{catalogError}</p>

            <button
              type="button"
              onClick={() => {
                void handleRetryCatalog();
              }}
            >
              إعادة المحاولة
            </button>
          </div>
        ) : (
          <form className="add-user-form" onSubmit={handleSubmit} noValidate>
            <div className="add-user-dialog__body">
              <div className="add-user-form__grid">
                <label className="add-user-field add-user-field--wide">
                  <span>الاسم الظاهر</span>

                  <input
                    type="text"
                    value={displayName}
                    placeholder="مثال: محمد أحمد"
                    autoComplete="off"
                    disabled={submitting}
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
                      value={username}
                      placeholder="mohamed"
                      dir="ltr"
                      autoCapitalize="none"
                      spellCheck={false}
                      autoComplete="off"
                      disabled={submitting}
                      onChange={(event) => {
                        setUsername(event.target.value);

                        clearError("username");
                      }}
                    />
                  </div>

                  {errors.username && <small>{errors.username}</small>}
                </label>

                <label className="add-user-field">
                  <span>كلمة المرور</span>

                  <div className="add-user-password">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      placeholder="8 أحرف على الأقل"
                      autoComplete="new-password"
                      disabled={submitting}
                      onChange={(event) => {
                        setPassword(event.target.value);

                        clearError("password");
                      }}
                    />

                    <button
                      type="button"
                      onClick={() => setShowPassword((current) => !current)}
                      aria-label={
                        showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"
                      }
                    >
                      <EyeIcon visible={showPassword} />
                    </button>
                  </div>

                  {errors.password && <small>{errors.password}</small>}
                </label>

                <label className="add-user-field">
                  <span>تأكيد كلمة المرور</span>

                  <input
                    type={showPassword ? "text" : "password"}
                    value={confirmPassword}
                    placeholder="أعد كتابة كلمة المرور"
                    autoComplete="new-password"
                    disabled={submitting}
                    onChange={(event) => {
                      setConfirmPassword(event.target.value);

                      clearError("confirmPassword");
                    }}
                  />

                  {errors.confirmPassword && (
                    <small>{errors.confirmPassword}</small>
                  )}
                </label>

                <label className="add-user-field">
                  <span>الدور الأساسي</span>

                  <select
                    value={baseRoleId}
                    disabled={submitting}
                    onChange={(event) => {
                      setBaseRoleId(event.target.value);

                      clearError("baseRoleId");
                    }}
                  >
                    <option value="">اختر الدور</option>

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
                    disabled={submitting}
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

              <div className="add-user-form__note">
                <strong>الصلاحيات</strong>

                <p>
                  المستخدم سيحصل الآن على صلاحيات الدور الأساسي. ويمكن تخصيص
                  صلاحيات إضافية أو منع صلاحيات معينة في خطوة إدارة المستخدم
                  التالية.
                </p>
              </div>
            </div>

            <footer className="add-user-form__actions">
              <button
                type="button"
                className="add-user-form__cancel"
                onClick={handleClose}
                disabled={submitting}
              >
                إلغاء
              </button>

              <button
                type="submit"
                className="add-user-form__submit"
                disabled={submitting}
              >
                {submitting ? (
                  <>
                    <span className="login-spinner" />
                    جارٍ إنشاء الحساب
                  </>
                ) : (
                  <>
                    <UserPlusIcon />
                    إنشاء المستخدم
                  </>
                )}
              </button>
            </footer>
          </form>
        )}
      </section>
    </div>,
    document.body,
  );
}
