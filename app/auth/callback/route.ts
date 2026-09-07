import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { ensureCity } from "@/lib/actions/auth";

/**
 * Where every email and OAuth link lands.
 *
 * Supabase can arrive here in three different shapes and this route has to
 * cope with all of them, because which one you get depends on how the link was
 * made rather than on anything the user did:
 *
 *   ?code=…                 PKCE. Needs the code verifier cookie, which only
 *                           exists in the browser that asked for the link.
 *   ?token_hash=…&type=…    Verifiable server-side with no verifier at all, so
 *                           it works on a different device. This is what an
 *                           email template using {{ .TokenHash }} produces.
 *   #access_token=…         Implicit flow, and a fragment the server can never
 *                           see. Handed to /auth/finish, which reads it in the
 *                           browser. Admin-generated and confirmation links
 *                           arrive this way.
 *
 * The old version handled only the first and answered every other link with
 * "Missing sign-in code".
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = searchParams.get("next");
  const nextParam = next ? `?next=${encodeURIComponent(next)}` : "";

  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  // Supabase reports its own failures in the query string.
  const errorDescription = searchParams.get("error_description") ?? searchParams.get("error");
  if (errorDescription) {
    return NextResponse.redirect(`${origin}/sign-in?error=${encodeURIComponent(errorDescription)}`);
  }

  const supabase = await createClient();

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) {
      return NextResponse.redirect(`${origin}/sign-in?error=${encodeURIComponent(error.message)}`);
    }
    await ensureCity();
    return NextResponse.redirect(`${origin}${safeNext(next)}`);
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      const message = /verifier/i.test(error.message)
        ? "That link was opened in a different browser than the one that asked for it. " +
          "Sign in with your password, or request a new link here."
        : error.message;
      return NextResponse.redirect(`${origin}/sign-in?error=${encodeURIComponent(message)}`);
    }
    await ensureCity();
    return NextResponse.redirect(`${origin}${safeNext(next)}`);
  }

  // No query parameters at all: the tokens are probably in the fragment, which
  // only the browser can read. Browsers re-attach a fragment across redirects.
  return NextResponse.redirect(`${origin}/auth/finish${nextParam}`);
}

function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/city";
  return next;
}
