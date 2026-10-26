"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadSprite } from "@/lib/actions/sprites";
import {
  hitAreaFromPixels,
  lotTiles,
  MAX_FOOTPRINT,
  MAX_SPRITE_BYTES,
  MAX_SPRITE_SIDE,
  spriteLayout,
  suggestFootprint,
  TEMPLATE_HEADROOM,
} from "@/lib/custom-sprites";
import { TILE_H, TILE_W } from "@/lib/iso";
import { LotPreview } from "./lot-preview";

type Picked = { file: File; url: string; width: number; height: number; hitArea: string | null };

const BUTTON = "border-2 border-ink px-3 py-1 font-pixel text-[10px] uppercase shadow-hard disabled:opacity-50";
const SIZES = Array.from({ length: MAX_FOOTPRINT }, (_, i) => i + 1);

/**
 * Add a sprite to the library.
 *
 * The image is read here, in the browser, because this is where there is a
 * canvas: its size, and the outline of its opaque pixels that becomes its hit
 * area. The server checks both against the bytes it receives.
 */
export function SpriteUploader() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [name, setName] = useState("");
  const [lot, setLot] = useState({ w: 1, h: 1 });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // A preview URL holds the file in memory until it is let go.
  useEffect(() => () => {
    if (picked) URL.revokeObjectURL(picked.url);
  }, [picked]);

  async function choose(file: File | undefined) {
    setError(null);
    setPicked(null);
    if (!file) return;
    if (file.type !== "image/png") {
      setError("Burg takes PNGs, so the transparent parts stay transparent.");
      return;
    }
    if (file.size > MAX_SPRITE_BYTES) {
      setError("That image is over 5 MB.");
      return;
    }

    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      setError("That PNG would not open.");
      return;
    }
    const { width, height } = bitmap;
    if (width > MAX_SPRITE_SIDE || height > MAX_SPRITE_SIDE) {
      bitmap.close();
      setError(`Keep it within ${MAX_SPRITE_SIDE} pixels on each side.`);
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      bitmap.close();
      setError("This window could not read the image.");
      return;
    }
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const hitArea = hitAreaFromPixels(context.getImageData(0, 0, width, height).data, width, height);

    const tiles = suggestFootprint(width);
    setLot({ w: tiles, h: tiles });
    setName(file.name.replace(/\.png$/i, "").replace(/[-_]+/g, " ").trim().slice(0, 80) || "Untitled");
    setPicked({ file, url: URL.createObjectURL(file), width, height, hitArea });
    if (!hitArea) setError("Nothing in that image is solid enough to click on. Is it all transparent?");
  }

  function upload() {
    if (!picked?.hitArea) return;
    const form = new FormData();
    form.set("image", picked.file);
    form.set("name", name);
    form.set("footprintW", String(lot.w));
    form.set("footprintH", String(lot.h));
    form.set("hitArea", picked.hitArea);

    startTransition(async () => {
      const result = await uploadSprite(form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPicked(null);
      setName("");
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    });
  }

  const sprite = picked?.hitArea
    ? { width: picked.width, height: picked.height, footprint_w: lot.w, footprint_h: lot.h, hit_area: picked.hitArea }
    : null;
  const layout = sprite ? spriteLayout(sprite) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="sprite-file" className="font-pixel text-[10px] uppercase text-stone">
            PNG image
          </label>
          <input
            ref={inputRef}
            id="sprite-file"
            type="file"
            accept="image/png"
            onChange={(e) => void choose(e.target.files?.[0])}
            className="font-body text-sm"
          />
        </div>

        <fieldset className="flex items-end gap-2">
          <legend className="mb-1 font-pixel text-[10px] uppercase text-stone">Lot, in tiles</legend>
          <label htmlFor="sprite-lot-w" className="sr-only">
            Lot width in tiles
          </label>
          <select
            id="sprite-lot-w"
            value={lot.w}
            onChange={(e) => setLot({ ...lot, w: Number(e.target.value) })}
            className="border-2 border-ink bg-snow px-2 py-1 font-body text-sm"
          >
            {SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <span aria-hidden className="pb-1 text-stone">
            ×
          </span>
          <label htmlFor="sprite-lot-h" className="sr-only">
            Lot depth in tiles
          </label>
          <select
            id="sprite-lot-h"
            value={lot.h}
            onChange={(e) => setLot({ ...lot, h: Number(e.target.value) })}
            className="border-2 border-ink bg-snow px-2 py-1 font-body text-sm"
          >
            {SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </fieldset>

        <button type="button" onClick={() => downloadTemplate(lot.w, lot.h)} className={`${BUTTON} bg-snow text-ink`}>
          Download a blank {lot.w}×{lot.h} lot
        </button>
      </div>

      {sprite && layout && picked ? (
        <div className="flex flex-wrap items-start gap-3 border-2 border-ink bg-snow p-3">
          <LotPreview sprite={sprite} src={picked.url} fit={256} />

          <div className="flex min-w-30 flex-1 flex-col gap-1">
            <label htmlFor="sprite-name" className="font-pixel text-[10px] uppercase text-stone">
              Name
            </label>
            <input
              id="sprite-name"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              className="border-2 border-ink bg-paper px-2 py-1 font-body text-sm"
            />
            <p className="font-body text-xs text-stone">
              {layout.crisp
                ? `${picked.width}×${picked.height} pixels on a ${lot.w}×${lot.h} lot: every pixel stays sharp.`
                : `${picked.width} pixels wide on a lot ${layout.width} wide, so it will be smoothed to fit. For sharp pixels, draw it ${layout.width} pixels wide, or exactly 2× or 3× that.`}
            </p>
            <button
              type="button"
              disabled={pending || !name.trim()}
              onClick={upload}
              className={`${BUTTON} self-start bg-gold text-ink`}
            >
              {pending ? "Adding…" : "Add to the library"}
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="font-body text-sm text-brick">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A transparent PNG at the lot's native size, with the lot's tiles marked at
 * its foot and room above for about four storeys: draw over it, keep the
 * width, and the result sits on the map exactly where it was drawn.
 *
 * The diamonds are filled a row of pixels at a time rather than stroked, so
 * their edges are the same clean 2:1 steps the map's own tiles have. Literal
 * colours, because this is a file for a drawing program, not a page.
 */
function downloadTemplate(footprintW: number, footprintH: number) {
  const width = (footprintW + footprintH) * (TILE_W / 2);
  const height = (footprintW + footprintH) * (TILE_H / 2) + TEMPLATE_HEADROOM;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return;

  for (const [top] of lotTiles(footprintW, footprintH, height)) {
    if (!top) continue;
    for (let row = 0; row < TILE_H; row++) {
      const half = row < TILE_H / 2 ? 2 * (row + 1) : 2 * (TILE_H - row);
      context.fillStyle = "rgba(75, 139, 59, 0.35)";
      context.fillRect(top.x - half, top.y + row, half * 2, 1);
      context.fillStyle = "rgba(23, 23, 31, 0.6)";
      context.fillRect(top.x - half, top.y + row, 2, 1);
      context.fillRect(top.x + half - 2, top.y + row, 2, 1);
    }
  }

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `burg-lot-${footprintW}x${footprintH}.png`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, "image/png");
}
