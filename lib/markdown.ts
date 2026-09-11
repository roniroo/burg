/**
 * A deliberately small Markdown reader, for the legal pages and nothing else.
 *
 * It returns typed blocks rather than an HTML string, so the renderer sets
 * text through React and there is no `dangerouslySetInnerHTML` and no escaping
 * question to get wrong. That is the whole reason this exists instead of a
 * dependency: the input is two files in this repo, the feature set they use is
 * closed, and the output is a legal document that has to be right.
 *
 * Supported, because that is what docs/*.md actually contain: ATX headings,
 * paragraphs, `**bold**`, `-` bullet lists, `>` blockquotes, `---` rules, and
 * pipe tables. Anything else passes through as literal text rather than being
 * silently dropped — a legal page that quietly loses a clause is worse than
 * one that shows a stray asterisk.
 *
 * Pure and DOM-free, like the rest of lib/.
 */

export type Inline = { text: string; bold: boolean };

export type Block =
  | { kind: "heading"; level: number; spans: Inline[] }
  | { kind: "paragraph"; spans: Inline[] }
  | { kind: "list"; items: Inline[][] }
  | { kind: "quote"; paragraphs: Inline[][] }
  | { kind: "table"; head: Inline[][]; rows: Inline[][][] }
  | { kind: "rule" };

/** Split a line into plain and bold runs. Unclosed `**` stays literal. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const pattern = /\*\*(.+?)\*\*/g;
  let last = 0;
  for (let m = pattern.exec(text); m !== null; m = pattern.exec(text)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), bold: false });
    out.push({ text: m[1] ?? "", bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), bold: false });
  return out.length > 0 ? out : [{ text, bold: false }];
}

const isRule = (line: string) => /^-{3,}\s*$/.test(line);
const isTableRow = (line: string) => line.trimStart().startsWith("|");
/** The `|---|---|` line under a table's header. */
const isTableDivider = (line: string) => /^\s*\|[\s:|-]+\|\s*$/.test(line) && line.includes("-");

function cells(line: string): Inline[][] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((c) => parseInline(c.trim()));
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];

  // Buffered paragraph lines, flushed when something ends them.
  let para: string[] = [];
  const flush = () => {
    if (para.length > 0) {
      blocks.push({ kind: "paragraph", spans: parseInline(para.join(" ")) });
      para = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    if (line.trim() === "") {
      flush();
      continue;
    }

    if (isRule(line)) {
      flush();
      blocks.push({ kind: "rule" });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({
        kind: "heading",
        level: (heading[1] ?? "#").length,
        spans: parseInline((heading[2] ?? "").trim()),
      });
      continue;
    }

    if (isTableRow(line) && isTableDivider(lines[i + 1] ?? "")) {
      flush();
      const head = cells(line);
      const rows: Inline[][][] = [];
      i += 2; // step over the header and its divider
      while (i < lines.length && isTableRow(lines[i] ?? "")) {
        rows.push(cells(lines[i] ?? ""));
        i++;
      }
      i--; // the loop's own increment takes the line that ended the table
      blocks.push({ kind: "table", head, rows });
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      flush();
      const items: Inline[][] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i] ?? "")) {
        items.push(parseInline((lines[i] ?? "").replace(/^\s*[-*+]\s+/, "")));
        i++;
      }
      i--;
      blocks.push({ kind: "list", items });
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      flush();
      const paragraphs: Inline[][] = [];
      let buffer: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i] ?? "")) {
        const body = (lines[i] ?? "").replace(/^\s*>\s?/, "");
        if (body.trim() === "") {
          if (buffer.length > 0) paragraphs.push(parseInline(buffer.join(" ")));
          buffer = [];
        } else {
          buffer.push(body);
        }
        i++;
      }
      i--;
      if (buffer.length > 0) paragraphs.push(parseInline(buffer.join(" ")));
      blocks.push({ kind: "quote", paragraphs });
      continue;
    }

    para.push(line.trim());
  }

  flush();
  return blocks;
}

/** The document's `# Title`, for the page heading and <title>. */
export function documentTitle(blocks: Block[], fallback: string): string {
  const h1 = blocks.find((b) => b.kind === "heading" && b.level === 1);
  if (h1 && h1.kind === "heading") return h1.spans.map((s) => s.text).join("");
  return fallback;
}
