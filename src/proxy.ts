import { type NextRequest, NextResponse } from "next/server";
import { isLocalHost } from "./lib/http/guard";

/**
 * Zodiac is a localhost-only tool. Rejecting non-loopback Host headers on
 * every request blocks DNS-rebinding attacks from reaching the UI or API,
 * including read-only pages that the mutation guard does not cover.
 */
export function proxy(request: NextRequest): NextResponse {
  if (!isLocalHost(request.headers.get("host"))) {
    return new NextResponse("仅允许通过 localhost 访问", { status: 403 });
  }
  return NextResponse.next();
}

export default proxy;

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};
