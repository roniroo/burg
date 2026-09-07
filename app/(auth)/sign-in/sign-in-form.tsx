"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { signInWithPassword, signUpWithPassword } from "@/lib/actions/auth";

type Mode = "signin" | "signup";

/**
 * Sign in.
 *
 * Password is the primary path because it is the only one that works from any
 * browser on any device with no email round trip. Magic links are offered too,
 * with their two real caveats stated rather than discovered: a link only works
 * in the browser that requested it, and Supabase's built-in mail server allows
 * only a few an hour.
 */
export function SignInForm({ next, initialError }: { next?: string; initialError?: string }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [notice, setNotice] = useState<string | null>(null);
  const [linkSent, setLinkSent] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    startTransition(async () => {
      const action = mode === "signin" ? signInWithPassword : signUpWithPassword;
      // A successful sign-in redirects from the server and never returns.
      const result = await action({ email, password, next });
      if (!result.ok) setError(result.error);
      else if (result.message) setNotice(result.message);
    });
  }

  async function sendMagicLink() {
    setError(null);
    setNotice(null);

    if (!email.trim()) {
      setError("Enter your email address first.");
      return;
    }

    const redirectTo = `${window.location.origin}/auth/callback${
      next ? `?next=${encodeURIComponent(next)}` : ""
    }`;

    const supabase = createClient();
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirectTo },
    });

    if (otpError) {
      setError(
        /rate limit/i.test(otpError.message)
          ? "Supabase's built-in mail server only allows a few messages an hour, and that is used up. Use your password instead."
          : otpError.message,
      );
      return;
    }
    setLinkSent(true);
  }

  async function signInWithGoogle() {
    const redirectTo = `${window.location.origin}/auth/callback${
      next ? `?next=${encodeURIComponent(next)}` : ""
    }`;
    const supabase = createClient();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (oauthError) setError(oauthError.message);
  }

  if (linkSent) {
    return (
      <div className="mt-6 flex flex-col gap-3">
        <p className="border-2 border-ink bg-gold p-3 font-pixel text-xs text-ink">
          Check your email for a link to your city.
        </p>
        <p className="font-body text-xs text-stone">
          Open it in this browser. A magic link carries half its proof in the browser that asked for
          it, so opening it elsewhere will not work.
        </p>
        <button
          type="button"
          onClick={() => setLinkSent(false)}
          className="self-start border-2 border-ink bg-paper px-3 py-2 font-pixel text-xs uppercase shadow-hard"
        >
          Back
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-6 flex flex-col gap-3">
      <div role="radiogroup" aria-label="Sign in or create an account" className="flex gap-1">
        {(["signin", "signup"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            onClick={() => {
              setMode(value);
              setError(null);
              setNotice(null);
            }}
            className="border-2 border-ink px-3 py-1 font-pixel text-[10px] uppercase shadow-hard"
            style={{ backgroundColor: mode === value ? "var(--color-gold)" : "var(--color-paper)" }}
          >
            {value === "signin" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>

      <label htmlFor="email" className="font-pixel text-xs uppercase text-stone">
        Email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="border-2 border-ink bg-paper px-3 py-2 font-body text-sm text-ink"
        placeholder="you@example.com"
      />

      <label htmlFor="password" className="font-pixel text-xs uppercase text-stone">
        Password
      </label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete={mode === "signin" ? "current-password" : "new-password"}
        required
        minLength={8}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="border-2 border-ink bg-paper px-3 py-2 font-body text-sm text-ink"
        placeholder={mode === "signup" ? "At least 8 characters" : ""}
      />

      {error ? (
        <p role="alert" className="border-2 border-brick bg-rose px-3 py-2 font-body text-xs text-ink">
          {error}
        </p>
      ) : null}

      {notice ? (
        <p role="status" className="border-2 border-ink bg-gold px-3 py-2 font-body text-xs text-ink">
          {notice}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="border-2 border-ink bg-amber px-3 py-2 font-pixel text-xs uppercase text-ink shadow-hard transition-transform duration-150 hover:translate-x-px hover:translate-y-px hover:shadow-hard-none disabled:opacity-60"
      >
        {pending ? "…" : mode === "signin" ? "Sign in" : "Create account"}
      </button>

      <div className="mt-2 flex flex-col gap-2 border-t-2 border-mist pt-3">
        <button
          type="button"
          onClick={sendMagicLink}
          className="border-2 border-ink bg-snow px-3 py-2 font-pixel text-xs uppercase text-ink shadow-hard"
        >
          Email me a link instead
        </button>
        <button
          type="button"
          onClick={signInWithGoogle}
          className="border-2 border-ink bg-snow px-3 py-2 font-pixel text-xs uppercase text-ink shadow-hard"
        >
          Continue with Google
        </button>
      </div>
    </form>
  );
}
