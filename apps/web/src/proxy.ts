import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Optimistic check only: the API verifies the token on every call.
export function proxy(request: NextRequest) {
  const signedIn = request.cookies.has("access_token");
  const { pathname } = request.nextUrl;
  const isLogin = pathname === "/login";

  if (!signedIn && !isLogin) {
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  if (signedIn && isLogin) return NextResponse.redirect(new URL("/", request.url));
  return NextResponse.next();
}

export const config = {
  // Everything except the API rewrite, Next internals and static files.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|webp|ico)$).*)"],
};
