import { Fragment } from "react";
import type { Block, Inline } from "@/lib/markdown";

/**
 * Renders the blocks lib/markdown.ts produced.
 *
 * Every string goes through React as text, so nothing here can inject markup
 * — which is the reason the parser returns blocks rather than an HTML string.
 *
 * A legal page is the one place in Burg where the pixel face gets out of the
 * way entirely: body type, generous line height, and a measure short enough to
 * read a clause without losing your place.
 */

function Spans({ spans }: { spans: Inline[] }) {
  return (
    <>
      {spans.map((span, i) =>
        span.bold ? (
          <strong key={i} className="font-semibold text-ink">
            {span.text}
          </strong>
        ) : (
          <Fragment key={i}>{span.text}</Fragment>
        ),
      )}
    </>
  );
}

const HEADING_CLASS: Record<number, string> = {
  1: "font-display text-3xl leading-tight text-ink",
  2: "mt-10 border-b-2 border-ink pb-2 font-display text-xl text-ink",
  3: "mt-8 font-display text-lg text-ink",
};

export function LegalDocument({ blocks }: { blocks: Block[] }) {
  return (
    <article className="prose-readable text-sm text-slate">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case "heading": {
            const Tag = (`h${Math.min(block.level, 6)}` as "h1");
            return (
              <Tag key={i} className={HEADING_CLASS[block.level] ?? "mt-6 font-display text-base text-ink"}>
                <Spans spans={block.spans} />
              </Tag>
            );
          }

          case "paragraph":
            return (
              <p key={i} className="mt-4">
                <Spans spans={block.spans} />
              </p>
            );

          case "list":
            return (
              <ul key={i} className="mt-4 flex list-disc flex-col gap-2 pl-6">
                {block.items.map((item, j) => (
                  <li key={j}>
                    <Spans spans={item} />
                  </li>
                ))}
              </ul>
            );

          case "quote":
            // The drafting notes still in these documents land here, which is
            // why they read as an aside rather than as the policy itself.
            return (
              <blockquote key={i} className="mt-4 border-l-4 border-gold bg-snow px-4 py-2">
                {block.paragraphs.map((p, j) => (
                  <p key={j} className={j === 0 ? "" : "mt-3"}>
                    <Spans spans={p} />
                  </p>
                ))}
              </blockquote>
            );

          case "table":
            return (
              <div key={i} className="mt-4 overflow-x-auto border-2 border-ink">
                <table className="w-full border-collapse text-left">
                  <thead className="bg-mist">
                    <tr>
                      {block.head.map((cell, j) => (
                        <th key={j} scope="col" className="border-b-2 border-ink px-3 py-2 font-pixel text-[10px] uppercase">
                          <Spans spans={cell} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, j) => (
                      <tr key={j} className="odd:bg-paper even:bg-snow">
                        {row.map((cell, k) => (
                          <td key={k} className="border-b border-mist px-3 py-2 align-top">
                            <Spans spans={cell} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );

          case "rule":
            return <hr key={i} className="mt-8 border-t-2 border-mist" />;
        }
      })}
    </article>
  );
}
