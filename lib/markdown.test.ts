import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { documentTitle, parseInline, parseMarkdown, type Block } from "./markdown";

const text = (b: Block): string => {
  if (b.kind === "heading" || b.kind === "paragraph") return b.spans.map((s) => s.text).join("");
  return "";
};

describe("parseInline", () => {
  it("splits bold runs out of plain text", () => {
    expect(parseInline("a **b** c")).toEqual([
      { text: "a ", bold: false },
      { text: "b", bold: true },
      { text: " c", bold: false },
    ]);
  });

  it("leaves an unclosed marker literal rather than eating the rest", () => {
    expect(parseInline("a ** b")).toEqual([{ text: "a ** b", bold: false }]);
  });

  it("never returns nothing for a non-empty line", () => {
    expect(parseInline("plain").length).toBeGreaterThan(0);
  });
});

describe("parseMarkdown", () => {
  it("reads headings with their level", () => {
    const [h] = parseMarkdown("### Third");
    expect(h).toMatchObject({ kind: "heading", level: 3 });
    expect(text(h!)).toBe("Third");
  });

  it("joins wrapped lines into one paragraph", () => {
    const blocks = parseMarkdown("one two\nthree four\n\nnext");
    expect(blocks).toHaveLength(2);
    expect(text(blocks[0]!)).toBe("one two three four");
  });

  it("collects consecutive bullets into a single list", () => {
    const [list] = parseMarkdown("- a\n- b\n- c");
    expect(list).toMatchObject({ kind: "list" });
    if (list?.kind === "list") expect(list.items).toHaveLength(3);
  });

  it("keeps a rule as a rule, not a heading underline", () => {
    const blocks = parseMarkdown("para\n\n---\n\nafter");
    expect(blocks.map((b) => b.kind)).toEqual(["paragraph", "rule", "paragraph"]);
  });

  it("reads a pipe table with its header", () => {
    const [t] = parseMarkdown("| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |");
    expect(t).toMatchObject({ kind: "table" });
    if (t?.kind === "table") {
      expect(t.head.map((c) => c.map((s) => s.text).join(""))).toEqual(["a", "b"]);
      expect(t.rows).toHaveLength(2);
      expect(t.rows[1]!.map((c) => c.map((s) => s.text).join(""))).toEqual(["3", "4"]);
    }
  });

  it("does not treat a lone pipe line as a table", () => {
    const blocks = parseMarkdown("| not a table");
    expect(blocks[0]?.kind).toBe("paragraph");
  });

  it("groups a blockquote's paragraphs", () => {
    const [q] = parseMarkdown("> one\n> two\n>\n> three");
    expect(q).toMatchObject({ kind: "quote" });
    if (q?.kind === "quote") expect(q.paragraphs).toHaveLength(2);
  });

  it("resumes normal parsing after a block ends", () => {
    const kinds = parseMarkdown("- a\n- b\nafter the list").map((b) => b.kind);
    expect(kinds).toEqual(["list", "paragraph"]);
  });
});

describe("the real legal documents", () => {
  // These are the only inputs this parser has to handle, so they are the test.
  for (const [file, fallback] of [
    ["docs/terms.md", "Terms"],
    ["docs/private-policy.md", "Privacy"],
  ] as const) {
    const blocks = parseMarkdown(readFileSync(file, "utf-8"));

    it(`${file} parses into blocks`, () => {
      expect(blocks.length).toBeGreaterThan(20);
    });

    it(`${file} keeps every heading`, () => {
      const source = readFileSync(file, "utf-8");
      const expected = (source.match(/^#{1,6} /gm) ?? []).length;
      expect(blocks.filter((b) => b.kind === "heading")).toHaveLength(expected);
    });

    it(`${file} loses no words`, () => {
      // The whole point: a legal page must not quietly drop a clause.
      const source = readFileSync(file, "utf-8");
      const words = (s: string) => (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).length;
      const rendered = blocks
        .map((b) => {
          if (b.kind === "heading" || b.kind === "paragraph") return b.spans.map((s) => s.text).join(" ");
          if (b.kind === "list") return b.items.flat().map((s) => s.text).join(" ");
          if (b.kind === "quote") return b.paragraphs.flat().map((s) => s.text).join(" ");
          if (b.kind === "table") return [...b.head, ...b.rows.flat()].flat().map((s) => s.text).join(" ");
          return "";
        })
        .join(" ");
      expect(words(rendered)).toBe(words(source));
    });

    it(`${file} has a title`, () => {
      expect(documentTitle(blocks, fallback).length).toBeGreaterThan(3);
    });
  }
});
