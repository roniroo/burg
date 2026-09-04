"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor, JSONContent, Range } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { Placeholder } from "@tiptap/extension-placeholder";
import { Image } from "@tiptap/extension-image";
import { BuildingLink, Callout, TableEmbed } from "@/lib/tiptap/nodes";
import {
  createMenuBridge,
  createSuggestionExtension,
  createValueStore,
  type MenuState,
  type SuggestionItem,
} from "@/lib/tiptap/suggestion-factory";
import { saveDocument } from "@/lib/actions/document";
import { SaveIndicator, type SaveState } from "./save-indicator";

export type LinkTarget = { id: string; title: string; artifactType: string; neighborhood: string };

const AUTOSAVE_MS = 800;

/**
 * The Library interior.
 *
 * Deliberately calm: readable body type, no ambient motion, no camera. The
 * only chrome is the slash menu, the [[ ]] picker and a scaffold that goes up
 * while a save is in flight.
 */
export function DocEditor({
  buildingId,
  initialContent,
  linkTargets,
}: {
  buildingId: string;
  initialContent: JSONContent;
  linkTargets: LinkTarget[];
}) {
  const [save, setSave] = useState<SaveState>("idle");
  const [menu, setMenu] = useState<(MenuState & { active: number }) | null>(null);

  /**
   * Mutable boxes bridging TipTap's imperative suggestion plugin to React.
   *
   * The plugin is built once at editor construction and cannot close over
   * changing state, so it reads through these instead. They are plain objects
   * held in state rather than refs, and they are refreshed in an effect after
   * every render -- writing to a ref during render is unsafe under concurrent
   * rendering, and React 19's lint rules rightly reject it.
   */
  const [bridge] = useState(createMenuBridge);
  const [targets] = useState(() => createValueStore(linkTargets));

  useEffect(() => {
    targets.set(linkTargets);
  }, [linkTargets, targets]);

  useEffect(() => {
    // No dependency array: every render refreshes the handlers so they always
    // see the current menu state.
    bridge.setHandlers({
      onOpen: (state) => setMenu({ ...state, active: 0 }),
      onUpdate: (state) =>
        setMenu((prev) => ({
          ...state,
          active: Math.min(prev?.active ?? 0, Math.max(0, state.items.length - 1)),
        })),
      onClose: () => setMenu(null),
      onKeyDown: (event) => {
        if (!menu || menu.items.length === 0) return false;

        if (event.key === "ArrowDown") {
          setMenu((m) => (m ? { ...m, active: (m.active + 1) % m.items.length } : m));
          return true;
        }
        if (event.key === "ArrowUp") {
          setMenu((m) => (m ? { ...m, active: (m.active - 1 + m.items.length) % m.items.length } : m));
          return true;
        }
        if (event.key === "Enter") {
          const item = menu.items[menu.active];
          if (item) menu.select(item);
          return true;
        }
        if (event.key === "Escape") {
          setMenu(null);
          return true;
        }
        return false;
      },
    });
  });

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Image,
      Placeholder.configure({
        placeholder: "Write, or press / for blocks and [[ to link a building…",
      }),
      BuildingLink,
      Callout,
      TableEmbed,

      createSuggestionExtension({
        name: "slashMenu",
        char: "/",
        getItems: (query) => slashItems(query),
        handlers: bridge,
      }),

      createSuggestionExtension({
        name: "buildingPicker",
        char: "[[",
        handlers: bridge,
        getItems: (query) => {
          const q = query.trim().toLowerCase();
          return targets
            .get()
            .filter((t) => t.id !== buildingId)
            .filter((t) => (q ? t.title.toLowerCase().includes(q) : true))
            .slice(0, 8)
            .map((t) => ({
              id: t.id,
              label: t.title,
              hint: t.neighborhood,
              glyph: t.artifactType === "table" ? "▦" : t.artifactType === "board" ? "▣" : "▤",
              run: (editor: Editor, range: Range) => {
                editor
                  .chain()
                  .focus()
                  .deleteRange(range)
                  .insertContent([
                    { type: "buildingLink", attrs: { buildingId: t.id, label: t.title } },
                    { type: "text", text: " " },
                  ])
                  .run();
              },
            }));
        },
      }),
    ],
    [buildingId, bridge, targets],
  );

  // --- autosave -----------------------------------------------------------
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<JSONContent | null>(null);

  const flush = useCallback(async () => {
    const content = latest.current;
    if (!content) return;
    latest.current = null;
    setSave("saving");
    const result = await saveDocument({ buildingId, content });
    setSave(result.ok ? "saved" : "error");
  }, [buildingId]);

  const editor = useEditor({
    extensions,
    content: initialContent,
    // Required for SSR: rendering immediately would mismatch on hydration.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "prose-readable min-h-96 outline-none",
        "aria-label": "Document body",
      },
    },
    onUpdate: ({ editor: e }) => {
      // ProseMirror builds node.attrs with Object.create(null). React's server
      // action serializer does not treat those as plain objects, so they arrive
      // as opaque client references and reading attrs.label throws on the
      // server. Round-tripping through JSON gives it ordinary objects.
      latest.current = JSON.parse(JSON.stringify(e.getJSON())) as JSONContent;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), AUTOSAVE_MS);
    },
  });

  // Save any pending edit when leaving, so a fast navigation cannot lose work.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (latest.current) void flush();
    };
  }, [flush]);

  return (
    <div className="relative">
      <div className="mb-3 flex justify-end">
        <SaveIndicator state={save} />
      </div>

      <EditorContent editor={editor} />

      {menu && menu.items.length > 0 ? (
        <ul
          role="listbox"
          aria-label="Insert"
          className="fixed z-50 max-h-72 w-72 overflow-auto border-2 border-ink bg-paper shadow-hard-lg"
          style={{
            left: Math.round(menu.rect?.left ?? 0),
            top: Math.round((menu.rect?.bottom ?? 0) + 4),
          }}
        >
          {menu.items.map((item, i) => (
            <li key={item.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === menu.active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  menu.select(item);
                }}
                className={`flex w-full items-center gap-2 px-2 py-1.5 text-left font-body text-sm ${
                  i === menu.active ? "bg-gold" : "bg-paper"
                }`}
              >
                <span aria-hidden className="font-pixel text-xs">
                  {item.glyph ?? "▪"}
                </span>
                <span className="flex-1 truncate">{item.label}</span>
                {item.hint ? (
                  <span className="font-pixel text-[10px] uppercase text-stone">{item.hint}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** The `/` menu: block types, filtered by the typed query. */
function slashItems(query: string): SuggestionItem[] {
  const all: SuggestionItem[] = [
    block("Heading 1", "H1", (e, r) => e.chain().focus().deleteRange(r).setNode("heading", { level: 1 }).run()),
    block("Heading 2", "H2", (e, r) => e.chain().focus().deleteRange(r).setNode("heading", { level: 2 }).run()),
    block("Heading 3", "H3", (e, r) => e.chain().focus().deleteRange(r).setNode("heading", { level: 3 }).run()),
    block("Text", "¶", (e, r) => e.chain().focus().deleteRange(r).setNode("paragraph").run()),
    block("Bullet list", "•", (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run()),
    block("Numbered list", "1.", (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run()),
    block("Checklist", "☑", (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run()),
    block("Quote", "❝", (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run()),
    block("Code block", "{}", (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run()),
    block("Divider", "—", (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run()),
    block("Callout", "▮", (e, r) =>
      e
        .chain()
        .focus()
        .deleteRange(r)
        .insertContent({ type: "callout", attrs: { tone: "note" }, content: [{ type: "paragraph" }] })
        .run(),
    ),
    block("Image", "▨", (e, r) => {
      const src = window.prompt("Image URL");
      if (!src) {
        e.chain().focus().deleteRange(r).run();
        return;
      }
      e.chain().focus().deleteRange(r).setImage({ src }).run();
    }),
  ];

  const q = query.trim().toLowerCase();
  return q ? all.filter((item) => item.label.toLowerCase().includes(q)) : all;
}

function block(label: string, glyph: string, run: (editor: Editor, range: Range) => void): SuggestionItem {
  return { id: label, label, glyph, run };
}
