"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updatePassword } from "@/lib/actions/auth";

export function NewPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    // Checked here rather than on the server because the server is only ever
    // told the password once -- a mismatch is a typo, not a security question.
    if (password !== confirm) {
      setError("Those two do not match.");
      return;
    }

    startTransition(async () => {
      const result = await updatePassword({ password });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone(true);
      router.push("/city");
    });
  }

  if (done) {
    return (
      <p role="status" className="mt-6 border-2 border-ink bg-gold p-3 font-pixel text-xs text-ink">
        Password changed. Taking you to your city…
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="mt-6 flex flex-col gap-3">
      <label htmlFor="new-password" className="font-pixel text-xs uppercase text-stone">
        New password
      </label>
      <input
        id="new-password"
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="At least 8 characters"
        className="border-2 border-ink bg-paper px-3 py-2 font-body text-sm text-ink"
      />

      <label htmlFor="confirm-password" className="font-pixel text-xs uppercase text-stone">
        Again
      </label>
      <input
        id="confirm-password"
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        className="border-2 border-ink bg-paper px-3 py-2 font-body text-sm text-ink"
      />

      {error ? (
        <p role="alert" className="border-2 border-brick bg-rose px-3 py-2 font-body text-xs text-ink">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="border-2 border-ink bg-amber px-3 py-2 font-pixel text-xs uppercase text-ink shadow-hard disabled:opacity-60"
      >
        {pending ? "…" : "Save password"}
      </button>
    </form>
  );
}
