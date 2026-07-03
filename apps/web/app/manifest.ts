import type { MetadataRoute } from "next";

import { APP_BACKGROUND_COLOR, APP_THEME_COLOR } from "../lib/presentation";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "JPX Accounting",
    short_name: "JPX",
    description:
      "AI advisory accounting for European small businesses — deadlines, insights, and compliant bookkeeping.",
    start_url: "/",
    display: "standalone",
    background_color: APP_BACKGROUND_COLOR,
    theme_color: APP_THEME_COLOR,
    orientation: "portrait",
    categories: ["finance", "productivity", "business"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    share_target: {
      action: "/share",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        title: "title",
        text: "text",
        url: "url",
        files: [
          {
            name: "files",
            accept: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"],
          },
        ],
      },
    },
  };
}
