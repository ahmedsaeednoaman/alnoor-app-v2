import type {
  Metadata,
} from "next";

import {
  BrandIntro,
} from "@/components/brand/brand-intro";

import {
  MedicalBackdrop,
} from "@/components/brand/medical-backdrop";

import {
  LoginForm,
} from "@/components/auth/login-form";

export const metadata:
  Metadata = {
  title:
    "تسجيل الدخول",

  description:
    "تسجيل الدخول إلى نظام النور للمناظير الطبية",
};

export default function LoginPage() {
  return (
    <main className="login-page">
      <MedicalBackdrop />

      <div
        className="login-corner-brand"
        aria-label="هوية النظام"
      >
        <strong>
          النور للمناظير الطبية
        </strong>

        <span>
          Alnoor Medical Operations
        </span>
      </div>

      <div
        className="login-context-label"
        aria-hidden="true"
      >
        <span>
          إدارة العمليات والمناظير الطبية
        </span>

        <svg viewBox="0 0 64 20">
          <path d="M1 10h13l4-8 7 16 6-15 5 7h27" />
        </svg>
      </div>

      <section
        className="login-panel"
        aria-label="تسجيل الدخول إلى النظام"
      >
        <div className="login-panel__inner">
          <BrandIntro />

          <LoginForm />

          <p className="login-panel__footer">
            جميع الحقوق محفوظة

            <span aria-hidden="true">
              {" | "}
            </span>

            النور للمناظير الطبية

            <bdi>
              {" "}
              ©{" "}
              {new Date().getFullYear()}
            </bdi>
          </p>
        </div>
      </section>
    </main>
  );
}