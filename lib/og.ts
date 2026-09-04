import { z } from "zod";

/**
 * Fetch a page's OpenGraph title and image.
 *
 * Runs server-side on a URL the user pasted, so it is an SSRF surface: only
 * http(s) is allowed, and hosts that resolve to the local machine or private
 * ranges are refused. A failed or slow fetch is not an error -- the link is
 * still worth saving, just without a title.
 */

export const urlSchema = z
  .string()
  .trim()
  .min(1, "Paste a link first.")
  .transform((raw) => (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`))
  .refine((raw) => {
    try {
      const url = new URL(raw);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }, "That does not look like a web address.");

const BLOCKED_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

/** Private and link-local ranges, which a pasted link has no business hitting. */
function isPrivateHost(hostname: string): boolean {
  if (BLOCKED_HOSTS.has(hostname)) return true;
  if (hostname.endsWith(".localhost") || hostname.endsWith(".internal")) return true;

  const v4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

export type OgResult = { title: string; imageUrl: string | null };

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function metaContent(html: string, property: string): string | null {
  // Attribute order varies, so match the tag then pull `content` out of it.
  const tag = new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]*>`, "i").exec(html);
  if (!tag) return null;
  const content = /content=["']([^"']*)["']/i.exec(tag[0]);
  return content?.[1] ? decodeEntities(content[1]).trim() : null;
}

export async function fetchOpenGraph(rawUrl: string): Promise<OgResult> {
  const url = new URL(rawUrl);
  const fallback: OgResult = { title: url.hostname.replace(/^www\./, "") + url.pathname, imageUrl: null };

  if (isPrivateHost(url.hostname)) return fallback;

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(5000),
      headers: {
        // Some sites serve a stub to unknown agents; ask politely for HTML.
        "user-agent": "Mozilla/5.0 (compatible; BurgBot/1.0; +https://burg.app)",
        accept: "text/html,application/xhtml+xml",
      },
    });

    if (!response.ok) return fallback;
    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("html")) return fallback;

    // Only the head matters, and an unbounded read of a hostile URL is a
    // denial-of-service waiting to happen.
    const html = (await response.text()).slice(0, 200_000);

    const title =
      metaContent(html, "og:title") ??
      metaContent(html, "twitter:title") ??
      (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]
        ? decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)![1]!).trim()
        : null);

    const image = metaContent(html, "og:image") ?? metaContent(html, "twitter:image");

    return {
      title: title?.slice(0, 200) || fallback.title,
      imageUrl: image ? new URL(image, url).toString() : null,
    };
  } catch {
    // Timeout, DNS failure, TLS failure: keep the link, drop the metadata.
    return fallback;
  }
}
