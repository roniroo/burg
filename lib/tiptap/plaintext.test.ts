import { describe, expect, it } from "vitest";
import { linkedBuildingIds, plaintextFromDoc } from "./plaintext";

const doc = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Launch Brief" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Detail lives in " },
        { type: "buildingLink", attrs: { buildingId: "b-roadmap", label: "Roadmap" } },
        { type: "text", text: " next door." },
      ],
    },
    {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { checked: true },
          content: [{ type: "paragraph", content: [{ type: "text", text: "Freeze the schema" }] }],
        },
      ],
    },
    { type: "tableEmbed", attrs: { buildingId: "b-roadmap", label: "Roadmap" } },
    { type: "horizontalRule" },
  ],
};

describe("plaintextFromDoc", () => {
  it("collects text across blocks", () => {
    const text = plaintextFromDoc(doc);
    expect(text).toContain("Launch Brief");
    expect(text).toContain("Freeze the schema");
  });

  it("includes the label of inline atoms, which carry no text node", () => {
    expect(plaintextFromDoc(doc)).toContain("Roadmap");
  });

  it("separates blocks with newlines so snippets do not run together", () => {
    expect(plaintextFromDoc(doc)).toMatch(/Launch Brief\n/);
  });

  it("never emits runs of blank lines or leading space", () => {
    const text = plaintextFromDoc(doc);
    expect(text).not.toMatch(/\n\n/);
    expect(text).toBe(text.trim());
  });

  it("survives empty and malformed input", () => {
    expect(plaintextFromDoc(null)).toBe("");
    expect(plaintextFromDoc(undefined)).toBe("");
    expect(plaintextFromDoc({ type: "doc" })).toBe("");
    expect(plaintextFromDoc({ type: "doc", content: [] })).toBe("");
  });
});

describe("linkedBuildingIds", () => {
  it("finds every referenced building exactly once", () => {
    // The same building is referenced by a wiki link and a table embed.
    expect(linkedBuildingIds(doc)).toEqual(["b-roadmap"]);
  });

  it("returns nothing for a document with no links", () => {
    expect(linkedBuildingIds({ type: "doc", content: [{ type: "paragraph" }] })).toEqual([]);
  });

  it("ignores links whose building id is missing", () => {
    const orphan = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "buildingLink", attrs: { label: "Ghost" } }] }],
    };
    expect(linkedBuildingIds(orphan)).toEqual([]);
  });
});
