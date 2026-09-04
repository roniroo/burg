"use client";

import { useState } from "react";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";

const emailSchema = z.string().trim().email("That does not look like an email address.");

export function SignInForm({
  next,
  initialError,
}: {
  next?: string;
  initialError?: string;
}) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(initialError ?? null);

  const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/auth/callback${
    next ? `?next=${encodeURIComponent(next)}` : ""
  }`;

  async function sendMagicLink(event: React.FormEvent) {
    event.preventDefault();
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid email.");
      return;
    }

    setStatus("sending");
    setError(null);
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email: parsed.data,
      options: { emailRedirectTo: redirectTo },
    });

    if (signInError) {
      setError(signInError.message);
      setStatus("idle");
      return;
    }
    setStatus("sent");
  }

  async function signInWithGoogle() {
    const supabase = createClient();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (oauthError) setError(oauthError.message);
  }

  if (status === "sent") {
    return (
      <p className="mt-6 border-2 border-ink bg-gold p-3 font-pixel text-xs text-ink">
        Check your email for a link to your city.
      </p>
    );
  }

  return (
    <form onSubmit={sendMagicLink} className="mt-6 flex flex-col gap-3">
      <label htmlFor="email" className="font-pixel text-xs uppercase text-stone">
        Email
      </label>
      <input
        id="email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="border-2 border-ink bg-paper px-3 py-2 font-body text-sm text-ink"
        placeholder="you@example.com"
      />

      {error ? (
        <p role="alert" className="border-2 border-brick bg-rose px-3 py-2 font-body text-xs text-ink">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={status === "sending"}
        className="border-2 border-ink bg-amber px-3 py-2 font-pixel text-xs uppercase text-ink shadow-hard transition-transform duration-150 hover:translate-x-px hover:translate-y-px hover:shadow-hard-none disabled:opacity-60"
      >
        {status === "sending" ? "Sending…" : "Send magic link"}
      </button>

      <button
        type="button"
        onClick={signInWithGoogle}
        className="border-2 border-ink bg-snow px-3 py-2 font-pixel text-xs uppercase text-ink shadow-hard transition-transform duration-150 hover:translate-x-px hover:translate-y-px hover:shadow-hard-none"
      >
        Continue with Google
      </button>
    </form>
  );
}
