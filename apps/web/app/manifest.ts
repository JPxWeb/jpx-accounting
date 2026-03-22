import type { MetadataRoute } from "next";

import { APP_BACKGROUND_COLOR, APP_THEME_COLOR } from "../lib/presentation";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "JPX Accounting",
    short_name: "JPX",
    description: "Mobile-first AI accounting portal for Swedish bookkeeping and advisory.",
    start_url: "/",
    display: "standalone",
    background_color: APP_BACKGROUND_COLOR,
    theme_color: APP_THEME_COLOR,
    orientation: "portrait",
    categories: ["finance", "productivity", "business"],
    share_target: {
      action: "/share",
      method: "GET",
      params: {
        title: "title",
        text: "text",
        url: "url",
      },
    },
  };
}
