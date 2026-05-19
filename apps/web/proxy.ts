import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

const REDIRECTS: Record<string, string> = {
  "/": "/today",
  "/settings": "/settings/company",
};

const publicPaths = ["/auth/login", "/auth/callback", "/share"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const target = REDIRECTS[pathname];
  if (target) {
    const destination = new URL(target, request.url);
    return NextResponse.redirect(destination, 308);
  }

  const runtimeMode = process.env.NEXT_PUBLIC_ACCOUNTING_RUNTIME_MODE ?? "demo";
  if (runtimeMode !== "normal") {
    return NextResponse.next();
  }

  if (publicPaths.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  if (!data?.claims && !pathname.startsWith("/auth/")) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/auth/login";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
