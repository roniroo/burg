import type { Json } from "@/lib/database.types";

/**
 * Flatten a TipTap document to plain text.
 *
 * Pure and dependency-free so it can run on the server (to fill
 * `documents.search_text`) without instantiating an editor. Block boundaries
 * become newlines so that search snippets do not run sentences together.
 */

type DocNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
};

const BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "listItem",
  "taskItem",
  "blockquote",
  "codeBlock",
  "callout",
  "horizontalRule",
  "tableEmbed",
]);

export function plaintextFromDoc(doc: Json | DocNode | null | undefined): string {
  const out: string[] = [];

  const walk = (node: DocNode | null | undefined): void => {
    if (!node || typeof node !== "object") return;

    if (typeof node.text === "string") {
      out.push(node.text);
      return;
    }

    // Atoms carry their text in attributes rather than child text nodes.
    if (node.type === "buildingLink" || node.type === "tableEmbed") {
      const label = node.attrs?.["label"];
      if (typeof label === "string" && label) out.push(label);
      return;
    }

    for (const child of node.content ?? []) walk(child);

    if (node.type && BLOCK_TYPES.has(node.type)) out.push("\n");
  };

  walk(doc as DocNode);

  return out
    .join(" ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** Every building referenced by a `buildingLink` or `tableEmbed` in a document. */
export function linkedBuildingIds(doc: Json | DocNode | null | undefined): string[] {
  const ids = new Set<string>();

  const walk = (node: DocNode | null | undefined): void => {
    if (!node || typeof node !== "object") return;
    if (node.type === "buildingLink" || node.type === "tableEmbed") {
      const id = node.attrs?.["buildingId"];
      if (typeof id === "string" && id) ids.add(id);
    }
    for (const child of node.content ?? []) walk(child);
  };

  walk(doc as DocNode);
  return [...ids];
}
