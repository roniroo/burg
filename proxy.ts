import { NextResponse, type NextRequest } from "next/server";

/**
 * Next 16 calls this the proxy; it is the old middleware convention renamed.
 *
 * There is no sign-in any more, so this is the whole of the door, and it asks
 * two things:
 *
 * 1. Was this addressed to this machine? The server only listens on loopback,
 *    but a web page can still reach a loopback port through DNS rebinding --
 *    a hostile name that resolves to 127.0.0.1 -- and its requests then carry
 *    that hostile name in `Host`. Refusing every Host that is not loopback
 *    closes that.
 * 2. In the desktop app, is this the app's own window? The app starts the
 *    server with a fresh random `BURG_LAUNCH_TOKEN` and hands the same token
 *    to its window as a cookie, so another program on the Mac, or another
 *    account on it, finds a port that answers nothing. `next dev` sets no
 *    token, so the dev server and the check suites are not asked.
 */

const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/** Kept in step with desktop/main.mjs, which sets it. */
const LAUNCH_COOKIE = "burg-launch";

export function proxy(request: NextRequest) {
  if (!LOOPBACK_HOST.test(request.headers.get("host") ?? "")) {
    return new NextResponse("Burg only answers on this machine.", { status: 403 });
  }

  const token = process.env.BURG_LAUNCH_TOKEN;
  if (token && request.cookies.get(LAUNCH_COOKIE)?.value !== token) {
    return new NextResponse("Open Burg from the app.", { status: 403 });
  }

  return NextResponse.next();
}

/**
 * Everything goes through the door except the build's static files and the
 * app's own icons, which the manifest fetches without cookies and which are
 * public anyway. The exemptions are named one by one on purpose: this used to
 * wave through any path starting with "sprites" or ending in ".png", from when
 * signed-out visitors needed the icons, and the sprite library and its images
 * are exactly the things the token is there to protect.
 */
export const config = {
  matcher: [
    "/((?!_next/static/|_next/image|favicon\\.ico$|manifest\\.webmanifest$|icon\\.svg$|apple-icon\\.png$|icon-192\\.png$|icon-512\\.png$).*)",
  ],
};
