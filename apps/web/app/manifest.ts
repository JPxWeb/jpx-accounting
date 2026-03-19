import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "JPX Accounting",
    short_name: "JPX",
    description: "Mobile-first AI accounting portal for Swedish bookkeeping and advisory.",
    start_url: "/",
    display: "standalone",
    background_color: "#eef4f5",
    theme_color: "#0f8f7f",
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

