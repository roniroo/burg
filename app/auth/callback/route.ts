import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { seedIdeaburg } from "@/lib/seed/ideaburg";

/**
 * OAuth / magic-link landing. Exchanges the code for a session, then seeds the
 * user's city on first sign-in so nobody ever sees an empty state.
 *
 * Seeding runs as the just-signed-in user, through RLS -- no service-role key.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/city";

  if (!code) {
    return NextResponse.redirect(`${origin}/sign-in?error=${encodeURIComponent("Missing sign-in code.")}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/sign-in?error=${encodeURIComponent(error.message)}`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    try {
      await seedIdeaburg(supabase, user.id);
    } catch (seedError) {
      // A failed seed must not strand the user on the sign-in page; they land
      // in an empty city and can retry from there.
      console.error("[burg] seed failed for", user.id, seedError);
    }
  }

  return NextResponse.redirect(`${origin}${next}`);
}
