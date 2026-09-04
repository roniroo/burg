import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignInForm } from "./sign-in-form";

export const metadata = { title: "Sign in — Burg" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect("/city");

  return (
    <main className="flex min-h-dvh items-center justify-center bg-paper p-6">
      <div className="w-full max-w-sm border-2 border-ink bg-snow p-6 shadow-hard-lg">
        <h1 className="font-display text-3xl text-ink">Burg</h1>
        <p className="mt-2 text-sm text-stone">
          A wiki and database workspace shaped like a small city.
        </p>
        <SignInForm next={next} initialError={error} />
      </div>
    </main>
  );
}
