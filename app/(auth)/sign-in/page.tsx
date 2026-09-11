import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignInForm } from "./sign-in-form";
import { SupportLink } from "@/components/support-link";

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
    <main className="flex min-h-dvh flex-col items-center justify-center bg-paper p-6">
      <div className="w-full max-w-sm border-2 border-ink bg-snow p-6 shadow-hard-lg">
        <h1 className="font-display text-3xl text-ink">Burg</h1>
        <p className="mt-2 text-sm text-stone">
          A wiki and database workspace shaped like a small city.
        </p>
        <SignInForm next={next} initialError={error} />
      </div>

      <p className="mt-4 text-center font-body text-xs text-stone">
        Burg is made by one person. <SupportLink variant="block" />
      </p>

      <nav aria-label="Legal" className="mt-4 flex items-center gap-3 font-pixel text-[10px] uppercase text-stone">
        <Link href="/terms" className="underline decoration-mist underline-offset-4 hover:text-ink">
          Terms
        </Link>
        <span aria-hidden>·</span>
        <Link href="/privacy" className="underline decoration-mist underline-offset-4 hover:text-ink">
          Privacy
        </Link>
      </nav>
    </main>
  );
}
