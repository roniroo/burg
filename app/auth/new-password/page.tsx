import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NewPasswordForm } from "./new-password-form";

export const metadata = { title: "Set a new password — Burg" };

/**
 * Where a recovery link lands, via /auth/callback.
 *
 * Following the link established a session, so this page is reachable only
 * with one. Someone who arrives without a session — an expired link, or a
 * bookmark — is sent back to ask for a fresh one rather than shown a form that
 * cannot work.
 */
export default async function NewPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in?error=That+reset+link+has+expired.+Ask+for+a+new+one.");
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-paper p-6">
      <div className="w-full max-w-sm border-2 border-ink bg-snow p-6 shadow-hard-lg">
        <h1 className="font-display text-2xl text-ink">Set a new password</h1>
        <p className="mt-2 font-body text-sm text-stone">
          Signed in as {user.email}. Choose something you have not used here before.
        </p>
        <NewPasswordForm />
      </div>
    </main>
  );
}
