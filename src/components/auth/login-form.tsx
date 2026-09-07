"use client";

import {
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";

import {
  zodResolver,
} from "@hookform/resolvers/zod";

import {
  useForm,
} from "react-hook-form";

import Swal from "sweetalert2";

import {
  z,
} from "zod";

const loginSchema =
  z.object({
    username:
      z
        .string()
        .trim()
        .min(
          1,
          "اسم المستخدم مطلوب",
        ),

    password:
      z
        .string()
        .min(
          1,
          "كلمة المرور مطلوبة",
        ),
  });

type LoginValues =
  z.infer<
    typeof loginSchema
  >;

type ApiError = {
  error?: {
    code?: string;
    message?: string;
    requestId?: string;
  };
};

const LOGO_PATH =
  "/images/Al-Noor Endoscope Medical Logo.png";

/* =========================================================
   ICONS
   ========================================================= */

function UserIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="7"
        r="4"
      />

      <path d="M4 21c0-4.5 3.1-8 8-8s8 3.5 8 8" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect
        x="4"
        y="10"
        width="16"
        height="11"
        rx="3"
      />

      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function EyeIcon({
  visible,
}: {
  visible: boolean;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />

      <circle
        cx="12"
        cy="12"
        r="3"
      />

      {!visible && (
        <path d="M4 4 20 20" />
      )}
    </svg>
  );
}

function LoginArrow() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4" />

      <path d="m14 16 4-4-4-4" />

      <path d="M18 12H8" />
    </svg>
  );
}

function ShieldIcon() {
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
      <path d="M12 3 5 6v5c0 4.6 2.8 8.1 7 10 4.2-1.9 7-5.4 7-10V6l-7-3Z" />

      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

/* =========================================================
   ALERT
   ========================================================= */

async function showAlert(
  options: {
    type:
      | "success"
      | "error"
      | "warning";

    title: string;

    message: string;

    button?: string;
  },
) {
  const icon =
    options.type ===
    "success"
      ? "success"
      : options.type ===
          "warning"
        ? "warning"
        : "error";

  const iconColor =
    options.type ===
    "success"
      ? "#48C6D9"
      : options.type ===
          "warning"
        ? "#FBBF24"
        : "#FB7185";

  await Swal.fire({
    icon,

    iconColor,

    imageUrl:
      LOGO_PATH,

    imageAlt:
      "النور للمناظير الطبية",

    imageWidth:
      150,

    title:
      options.title,

    text:
      options.message,

    confirmButtonText:
      options.button ??
      "حسناً",

    buttonsStyling:
      false,

    customClass: {
      popup:
        "alnoor-alert",

      image:
        "alnoor-alert__logo",

      icon:
        "alnoor-alert__icon",

      title:
        "alnoor-alert__title",

      htmlContainer:
        "alnoor-alert__text",

      confirmButton:
        "alnoor-alert__button",
    },

    showClass: {
      popup:
        "alnoor-alert-show",
    },

    hideClass: {
      popup:
        "alnoor-alert-hide",
    },
  });
}

/* =========================================================
   COMPONENT
   ========================================================= */

export function LoginForm() {
  const router =
    useRouter();

  const [
    showPassword,
    setShowPassword,
  ] =
    useState(false);

  const {
    register,
    handleSubmit,
    formState: {
      errors,
      isSubmitting,
    },
  } =
    useForm<LoginValues>({
      resolver:
        zodResolver(
          loginSchema,
        ),

      defaultValues: {
        username: "",
        password: "",
      },
    });

  const onSubmit =
    async (
      values:
        LoginValues,
    ) => {
      try {
        const response =
          await fetch(
            "/api/v1/auth/login",
            {
              method:
                "POST",

              headers: {
                "Content-Type":
                  "application/json",
              },

              body:
                JSON.stringify(
                  values,
                ),
            },
          );

        const body =
          (await response
            .json()
            .catch(
              () => ({}),
            )) as ApiError;

        /* SUCCESS */

        if (
          response.ok
        ) {
          await showAlert({
            type:
              "success",

            title:
              "تم تسجيل الدخول بنجاح",

            message:
              "مرحباً بك في نظام النور للمناظير الطبية.",

            button:
              "متابعة",
          });

          router.replace(
            "/",
          );
          router.refresh();

          return;
        }

        const code =
          body.error
            ?.code;

        /* BLOCKED */

        if (
          code ===
            "ACCOUNT_BLOCKED" ||
          code ===
            "ACCOUNT_SUSPENDED"
        ) {
          await showAlert({
            type:
              "warning",

            title:
              "الحساب غير متاح",

            message:
              body.error
                ?.message ??
              "هذا الحساب غير متاح حالياً.",
          });

          return;
        }

        /* BAD CREDENTIALS */

        if (
          response.status ===
            401 ||
          code ===
            "INVALID_CREDENTIALS"
        ) {
          await showAlert({
            type:
              "error",

            title:
              "تعذر تسجيل الدخول",

            message:
              "اسم المستخدم أو كلمة المرور غير صحيحة.",

            button:
              "إعادة المحاولة",
          });

          return;
        }

        await showAlert({
          type:
            "error",

          title:
            "تعذر تسجيل الدخول",

          message:
            body.error
              ?.message ??
            "حدث خطأ غير متوقع.",
        });
      } catch {
        await showAlert({
          type:
            "error",

          title:
            "تعذر الاتصال",

          message:
            "تعذر الوصول إلى خدمة تسجيل الدخول. حاول مرة أخرى.",
        });
      }
    };

  return (
    <div className="login-content">
      <div className="login-content__heading">
        <h1>
          مرحباً بعودتك
        </h1>

        <p>
          سجّل دخولك للمتابعة وإدارة عمليات الشركة
        </p>
      </div>

      <form
        className="login-form"
        onSubmit={
          handleSubmit(
            onSubmit,
          )
        }
        noValidate
      >
        {/* USERNAME */}

        <div className="login-field">
          <label htmlFor="username">
            اسم المستخدم
          </label>

          <div
            className={[
              "login-field__control",
              errors.username
                ? "login-field__control--error"
                : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <input
              id="username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="اسم المستخدم"
              aria-invalid={
                Boolean(
                  errors.username,
                )
              }
              {...register(
                "username",
              )}
            />

            <span
              className="login-field__icon"
              aria-hidden="true"
            >
              <UserIcon />
            </span>
          </div>

          {errors.username && (
            <p className="login-field__error">
              {
                errors
                  .username
                  .message
              }
            </p>
          )}
        </div>

        {/* PASSWORD */}

        <div className="login-field">
          <label htmlFor="password">
            كلمة المرور
          </label>

          <div
            className={[
              "login-field__control",
              errors.password
                ? "login-field__control--error"
                : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <input
              id="password"
              type={
                showPassword
                  ? "text"
                  : "password"
              }
              autoComplete="current-password"
              placeholder="كلمة المرور"
              aria-invalid={
                Boolean(
                  errors.password,
                )
              }
              {...register(
                "password",
              )}
            />

            <span
              className="login-field__icon"
              aria-hidden="true"
            >
              <LockIcon />
            </span>

            <button
              type="button"
              className="login-field__eye"
              onClick={() =>
                setShowPassword(
                  (current) =>
                    !current,
                )
              }
              aria-label={
                showPassword
                  ? "إخفاء كلمة المرور"
                  : "إظهار كلمة المرور"
              }
            >
              <EyeIcon
                visible={
                  showPassword
                }
              />
            </button>
          </div>

          {errors.password && (
            <p className="login-field__error">
              {
                errors
                  .password
                  .message
              }
            </p>
          )}
        </div>

        {/* BUTTON */}

        <button
          type="submit"
          className="login-submit"
          disabled={
            isSubmitting
          }
        >
          {isSubmitting ? (
            <>
              <span className="login-spinner" />

              <span>
                جارٍ تسجيل الدخول
              </span>
            </>
          ) : (
            <>
              <span>
                تسجيل الدخول
              </span>

              <LoginArrow />
            </>
          )}
        </button>

        <div className="login-security">
          <i />

          <div>
            <ShieldIcon />

            <span>
              اتصال آمن ومشفّر
            </span>
          </div>

          <i />
        </div>
      </form>
    </div>
  );
}
