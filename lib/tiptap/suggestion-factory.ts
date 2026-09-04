import { Extension } from "@tiptap/core";
import Suggestion, { type SuggestionOptions } from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import type { Editor, Range } from "@tiptap/core";

/**
 * A thin bridge from TipTap's suggestion plugin to React state.
 *
 * The plugin is created once, at editor construction, so it cannot close over
 * changing React state directly. Instead it calls the handlers on a mutable
 * `bridge` object that the component updates, which keeps the extension array
 * stable across renders.
 */

export type SuggestionItem = {
  id: string;
  label: string;
  hint?: string;
  glyph?: string;
  run: (editor: Editor, range: Range) => void;
};

export type MenuState = {
  items: SuggestionItem[];
  rect: DOMRect | null;
  select: (item: SuggestionItem) => void;
};

export type SuggestionBridge = {
  onOpen: (state: MenuState) => void;
  onUpdate: (state: MenuState) => void;
  onClose: () => void;
  /** Returns true when the popup consumed the key. */
  onKeyDown: (event: KeyboardEvent) => boolean;
};

const NOOP_HANDLERS: SuggestionBridge = {
  onOpen: () => {},
  onUpdate: () => {},
  onClose: () => {},
  onKeyDown: () => false,
};

/**
 * A stable dispatcher between the suggestion plugin and React.
 *
 * The plugin is built once at editor construction, so it cannot see later
 * renders' state. This object's identity never changes; the component swaps
 * the handlers behind it from an effect via `setHandlers`. It is deliberately
 * not a ref: refs must not be read or written during render, and a plain
 * object with a method sidesteps that whole class of problem.
 */
export type MenuBridge = SuggestionBridge & { setHandlers: (next: SuggestionBridge) => void };

/**
 * A stable, mutable value holder with the same rationale as MenuBridge: the
 * suggestion plugin needs to read the current value long after render, and a
 * ref cannot be safely read or written during one.
 */
export type ValueStore<T> = { get: () => T; set: (next: T) => void };

export function createValueStore<T>(initial: T): ValueStore<T> {
  let value = initial;
  return {
    get: () => value,
    set: (next) => {
      value = next;
    },
  };
}

export function createMenuBridge(): MenuBridge {
  let handlers: SuggestionBridge = NOOP_HANDLERS;
  return {
    setHandlers: (next) => {
      handlers = next;
    },
    onOpen: (state) => handlers.onOpen(state),
    onUpdate: (state) => handlers.onUpdate(state),
    onClose: () => handlers.onClose(),
    onKeyDown: (event) => handlers.onKeyDown(event),
  };
}

export function createSuggestionExtension({
  name,
  char,
  getItems,
  handlers,
}: {
  name: string;
  char: string;
  getItems: (query: string) => SuggestionItem[];
  handlers: SuggestionBridge;
}) {
  const pluginKey = new PluginKey(name);

  return Extension.create({
    name,

    addProseMirrorPlugins() {
      const options: SuggestionOptions<SuggestionItem, SuggestionItem> = {
        editor: this.editor,
        char,
        pluginKey,
        // `[[` should be reachable mid-sentence, not just after a space.
        allowedPrefixes: null,
        items: ({ query }) => getItems(query),
        command: ({ editor, range, props }) => props.run(editor, range),
        render: () => ({
          onStart: (props) => {
            handlers.onOpen({
              items: props.items,
              rect: props.clientRect?.() ?? null,
              select: (item) => props.command(item),
            });
          },
          onUpdate: (props) => {
            handlers.onUpdate({
              items: props.items,
              rect: props.clientRect?.() ?? null,
              select: (item) => props.command(item),
            });
          },
          onKeyDown: (props) => handlers.onKeyDown(props.event),
          onExit: () => handlers.onClose(),
        }),
      };

      return [Suggestion(options)];
    },
  });
}
