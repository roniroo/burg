import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/database.types";

/**
 * Routes reachable without a session. Everything else redirects to sign-in.
 *
 * The legal pages are public on purpose: someone has to be able to read the
 * terms before agreeing to them, and a privacy policy behind a login is not a
 * privacy policy.
 *
 * The Stripe webhook is public because Stripe has no session and never will;
 * what stands in for one is the signature check in the route itself, which
 * verifies an HMAC of the raw body. Note the exact path rather than `/api`:
 * opening the whole prefix would make every future route public by default,
 * which is the wrong way round.
 */
const PUBLIC_PATHS = [
  "/sign-in",
  "/auth",
  "/terms",
  "/privacy",
  "/api/stripe/webhook",
  "/_next",
  "/favicon.ico",
  // The matcher in proxy.ts exempts anything ending in an image extension, so
  // the icons are already through; the manifest has no extension it
  // recognises, and a browser that is told to fetch it from the sign-in page
  // would otherwise be answered with a redirect back to the sign-in page.
  "/manifest.webmanifest",
  "/sprites",
];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Do not remove: this refreshes the auth token on every request.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return response;
}
