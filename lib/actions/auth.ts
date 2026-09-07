"use server";

import type { Route } from "next";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { seedIdeaburg } from "@/lib/seed/ideaburg";

/**
 * Password auth.
 *
 * Run as server actions rather than from the browser so the session cookie is
 * written by the server and the tokens never pass through client JavaScript.
 *
 * Password is the primary way in. Magic links are kept as an option, but they
 * cannot be the only one: a PKCE magic link only works in the browser that
 * asked for it, and Supabase's built-in SMTP is rate limited to a handful of
 * emails an hour, so a link is easy to want and hard to get.
 */

const credentials = z.object({
  email: z.string().trim().email("That does not look like an email address."),
  password: z.string().min(8, "Use at least 8 characters."),
  next: z.string().optional(),
});

export type AuthResult = { ok: true; message?: string } | { ok: false; error: string };

/**
 * Only ever redirect within this app.
 *
 * `next` arrives from a query string, so it is attacker-controlled: anything
 * that is not a plain absolute path on this origin falls back to /city. The
 * cast is safe precisely because of that check -- typedRoutes cannot know a
 * runtime string is a real route.
 */
function safeNext(next: string | undefined): Route {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/city" as Route;
  return next as Route;
}

/**
 * Give the signed-in user a city if they have none.
 *
 * Called from every sign-in path rather than only the magic-link callback, so
 * however someone gets in, they land in something alive. Idempotent.
 */
export async function ensureCity(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  try {
    await seedIdeaburg(supabase, user.id);
  } catch (error) {
    // A failed seed must not block sign-in; the city page copes with none.
    console.error("[burg] seed failed for", user.id, error);
  }
}

export async function signInWithPassword(input: unknown): Promise<AuthResult> {
  const parsed = credentials.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check those details." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    // Supabase says "Invalid login credentials" for both a wrong password and
    // an unknown address, which is the right thing to tell the user too.
    return { ok: false, error: error.message };
  }

  await ensureCity();
  redirect(safeNext(parsed.data.next));
}

export async function signUpWithPassword(input: unknown): Promise<AuthResult> {
  const parsed = credentials.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check those details." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) return { ok: false, error: error.message };

  // With email confirmation on, signUp returns a user but no session: nothing
  // to redirect into yet. With it off, we are already signed in.
  if (!data.session) {
    return {
      ok: true,
      message:
        "Account created. Check your email to confirm it, then sign in. " +
        "(Turn off Confirm email in Supabase to skip this step.)",
    };
  }

  await ensureCity();
  redirect(safeNext(parsed.data.next));
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  // Local scope: end this browser's session only. Supabase defaults to
  // "global", which revokes every refresh token the user holds and would sign
  // them out of their phone and their other laptop too.
  await supabase.auth.signOut({ scope: "local" });
  redirect("/sign-in");
}
