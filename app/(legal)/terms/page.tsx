import { LegalDocument } from "@/components/legal/legal-document";
import { readLegal } from "@/lib/legal";

export const metadata = { title: "Terms of Service — Burg" };

export default async function TermsPage() {
  return <LegalDocument blocks={await readLegal("terms")} />;
}
