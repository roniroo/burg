/**
 * The legal documents, read from docs/ at request time.
 *
 * They live as Markdown in the repo rather than in the database so that
 * changing them is a reviewed commit with a diff and a date, which is what
 * "Last updated" on a policy page is supposed to mean.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseMarkdown, type Block } from "@/lib/markdown";

export const LEGAL = {
  terms: { file: "terms.md", title: "Terms of Service" },
  privacy: { file: "private-policy.md", title: "Privacy Policy" },
} as const;

export type LegalKey = keyof typeof LEGAL;

export async function readLegal(key: LegalKey): Promise<Block[]> {
  const source = await readFile(path.join(process.cwd(), "docs", LEGAL[key].file), "utf-8");
  return parseMarkdown(source);
}
