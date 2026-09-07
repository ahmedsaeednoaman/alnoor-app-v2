import type { Metadata, Viewport } from "next";

import { ServiceWorkerRegistration } from "@/components/pwa/service-worker-registration";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "النور للمناظير الطبية",
    template: "%s | النور للمناظير الطبية",
  },
  description: "نظام النور لإدارة العمليات الطبية",
  applicationName: "النور للمناظير الطبية",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "النور",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icons/pwa-192.png", sizes: "192x192", type: "image/png" },
    ],
    shortcut: "/icons/pwa-192.png",
    apple: [
      {
        url: "/icons/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F8FAFC" },
    { media: "(prefers-color-scheme: dark)", color: "#0B2F4A" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl" className="h-full antialiased">
      <body className="min-h-full">
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
