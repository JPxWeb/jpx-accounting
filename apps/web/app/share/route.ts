import { NextResponse } from "next/server";

// PWA share target intake. The manifest declares method=POST + multipart/form-data, so the
// browser POSTs shared content (text + url + files) here. We accept the payload, then redirect
// to /capture where the user can see what came in and promote it through the normal review path.
//
// GET requests (someone navigating to /share manually) get redirected straight to /capture.
//
// Until the upload pipeline is live in normal mode, files arrive but are not yet staged into
// blob storage from this handler. /capture reads ?shared=1&pending=<n> and surfaces a hint.

async function buildRedirectParams(request: Request): Promise<URLSearchParams> {
  const params = new URLSearchParams();
  if (request.method === "POST") {
    try {
      const form = await request.formData();
      const title = String(form.get("title") ?? "");
      const text = String(form.get("text") ?? "");
      const url = String(form.get("url") ?? "");
      const files = form.getAll("files").filter((entry): entry is File => entry instanceof File);
      if (title) params.set("title", title);
      if (text) params.set("text", text);
      if (url) params.set("url", url);
      if (files.length > 0) {
        params.set("shared", "1");
        params.set("pending", String(files.length));
      }
    } catch {
      // Malformed multipart — fall through with no params; /capture still loads cleanly.
    }
  } else {
    const urlObj = new URL(request.url);
    for (const [key, value] of urlObj.searchParams) {
      params.set(key, value);
    }
  }
  return params;
}

async function redirectToCapture(request: Request): Promise<Response> {
  const params = await buildRedirectParams(request);
  const target = params.toString() ? `/capture?${params}` : "/capture";
  return NextResponse.redirect(new URL(target, request.url), 303);
}

export async function POST(request: Request): Promise<Response> {
  return redirectToCapture(request);
}

export async function GET(request: Request): Promise<Response> {
  return redirectToCapture(request);
}
