import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE, hasAdminSession } from "./src/lib/admin-auth";

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const authenticated = hasAdminSession(request.cookies.get(ADMIN_SESSION_COOKIE)?.value);

  if (pathname === "/") return NextResponse.next();

  if (pathname === "/login") {
    return authenticated ? NextResponse.redirect(new URL("/", request.url)) : NextResponse.next();
  }

  if (
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt"
  ) {
    return NextResponse.next();
  }

  if (authenticated) return NextResponse.next();

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  loginUrl.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
