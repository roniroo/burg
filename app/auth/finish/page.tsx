import { FinishSignIn } from "./finish-sign-in";

export const metadata = { title: "Signing in — Burg" };

/**
 * The fragment landing.
 *
 * Implicit-flow links put the session in the URL fragment, which never reaches
 * the server. This page exists solely so a client component can read it.
 */
export default async function FinishPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <FinishSignIn next={next} />;
}
