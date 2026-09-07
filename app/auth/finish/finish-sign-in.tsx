"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { createClient } from "@/lib/supabase/client";
import { ensureCity } from "@/lib/actions/auth";

/**
 * Reads an implicit-flow session out of the URL fragment and stores it.
 *
 * The browser client writes the session to cookies, so the server sees it on
 * the very next request. The fragment is cleared afterwards: leaving a refresh
 * token in the address bar would be careless.
 */
export function FinishSignIn({ next }: { next?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // All of this runs inside the async body so nothing sets state
    // synchronously during the effect, which would cost an extra render pass.
    void (async () => {
      const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
      const params = new URLSearchParams(hash);

      const described = params.get("error_description") ?? params.get("error");
      if (described) {
        setError(described);
        return;
      }

      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      if (!accessToken || !refreshToken) {
        setError("That sign-in link did not carry a session. Ask for a new one.");
        return;
      }

      const supabase = createClient();
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (sessionError) {
        setError(sessionError.message);
        return;
      }

      // Never leave a refresh token sitting in the address bar.
      window.history.replaceState(null, "", window.location.pathname);
      await ensureCity();

      const target: Route =
        next && next.startsWith("/") && !next.startsWith("//") ? (next as Route) : "/city";
      router.replace(target);
      router.refresh();
    })();
  }, [next, router]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-paper p-6">
      <div className="w-full max-w-sm border-2 border-ink bg-snow p-6 shadow-hard-lg">
        <h1 className="font-display text-2xl text-ink">{error ? "That didn't work" : "Signing you in…"}</h1>
        {error ? (
          <>
            <p role="alert" className="mt-3 border-2 border-brick bg-rose px-3 py-2 font-body text-sm">
              {error}
            </p>
            <a
              href="/sign-in"
              className="mt-4 inline-block border-2 border-ink bg-amber px-3 py-2 font-pixel text-xs uppercase shadow-hard"
            >
              Back to sign in
            </a>
          </>
        ) : (
          <p className="mt-2 font-body text-sm text-stone">One moment.</p>
        )}
      </div>
    </main>
  );
}
