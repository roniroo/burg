import { LegalDocument } from "@/components/legal/legal-document";
import { readLegal } from "@/lib/legal";

export const metadata = { title: "Privacy Policy — Burg" };

export default async function PrivacyPage() {
  return <LegalDocument blocks={await readLegal("privacy")} />;
}
