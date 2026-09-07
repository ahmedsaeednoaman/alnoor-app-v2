import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "النور للمناظير الطبية",
    short_name: "النور",
    description: "نظام النور لإدارة العمليات الطبية",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#061827",
    theme_color: "#0B2F4A",
    lang: "ar",
    dir: "rtl",
    icons: [
      {
        src: "/icons/pwa-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/pwa-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/pwa-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
