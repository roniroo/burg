import { Node, mergeAttributes } from "@tiptap/core";

/**
 * Custom document nodes.
 *
 * `buildingLink` is the important one: it is the editor's half of the road
 * network. Every one of these in a document becomes a row in `building_links`
 * on save, which is what makes a road appear on the map.
 */

export interface BuildingLinkAttrs {
  buildingId: string | null;
  label: string;
}

export const BuildingLink = Node.create({
  name: "buildingLink",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      buildingId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-building-id"),
        renderHTML: (attributes) => ({ "data-building-id": attributes.buildingId as string }),
      },
      label: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-label") ?? element.textContent ?? "",
        renderHTML: (attributes) => ({ "data-label": attributes.label as string }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-building-link]" }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-building-link": "",
        class:
          "border-2 border-ink bg-gold px-1 font-body text-[0.9em] whitespace-nowrap",
      }),
      `${node.attrs.label as string}`,
    ];
  },

  /** Plain-text form, used by search indexing and copy/paste. */
  renderText({ node }) {
    return `[[${node.attrs.label as string}]]`;
  },
});

/** A callout block: an aside that should not be mistaken for body copy. */
export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      tone: {
        default: "note",
        parseHTML: (element) => element.getAttribute("data-tone") ?? "note",
        renderHTML: (attributes) => ({ "data-tone": attributes.tone as string }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-callout]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-callout": "",
        class: "border-2 border-ink bg-sand p-3 my-3 shadow-hard",
      }),
      0,
    ];
  },
});

/**
 * A reference to a Warehouse, rendered as a card in the document.
 *
 * Deliberately an embed, not a copy: the table's rows live in the warehouse,
 * and this is a door to them.
 */
export const TableEmbed = Node.create({
  name: "tableEmbed",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      buildingId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-building-id"),
        renderHTML: (attributes) => ({ "data-building-id": attributes.buildingId as string }),
      },
      label: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-label") ?? "",
        renderHTML: (attributes) => ({ "data-label": attributes.label as string }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-table-embed]" }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-table-embed": "",
        class: "border-2 border-ink bg-snow p-3 my-3 shadow-hard font-body text-sm",
      }),
      `▦ ${node.attrs.label as string}`,
    ];
  },

  renderText({ node }) {
    return `[table: ${node.attrs.label as string}]`;
  },
});
