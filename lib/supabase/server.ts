import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/database.types";

/**
 * Server-side Supabase client bound to the request's cookies.
 *
 * `setAll` throws when called from a Server Component (cookies are read-only
 * there). That is expected and safe to swallow: middleware refreshes the
 * session on every request, so the only lost writes are redundant ones.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component; middleware handles the refresh.
          }
        },
      },
    },
  );
}

/**
 * Service-role client. Bypasses RLS -- server-only, never import from a
 * client component. Only `npm run seed` needs this; the app's own first
 * sign-in seeding runs as the signed-in user through RLS.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. Add it to .env.local to run the CLI seed.",
    );
  }
  return createServerClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    cookies: { getAll: () => [], setAll: () => {} },
  });
}
