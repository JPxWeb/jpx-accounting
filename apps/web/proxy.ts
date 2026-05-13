import { type NextRequest, NextResponse } from "next/server";

const REDIRECTS: Record<string, string> = {
  "/": "/today",
  "/assistant": "/today?advisor=open",
  "/settings": "/settings/company",
};

export function proxy(request: NextRequest) {
  const target = REDIRECTS[request.nextUrl.pathname];
  if (!target) {
    return NextResponse.next();
  }

  const destination = new URL(target, request.url);
  return NextResponse.redirect(destination, 308);
}

export const config = {
  matcher: ["/", "/assistant", "/settings"],
};
