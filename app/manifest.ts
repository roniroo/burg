import type { MetadataRoute } from "next";

/**
 * The web app manifest, which is what turns an installed Burg into an icon on
 * a home screen rather than a browser shortcut with a screenshot in it.
 *
 * The 192 and 512 sizes are not arbitrary: they are the two the install
 * prompt looks for, which is why the assets exist at exactly those sizes.
 * Both are marked `maskable` as well as `any` -- the artwork carries its own
 * sky background out to the edges, so Android cropping it to a circle or a
 * squircle takes sky, not a clipped corner of the tower.
 *
 * `background_color` matches the paper the app is drawn on and the
 * `themeColor` in the root layout; a white splash behind a cream app is the
 * one frame of an install that looks broken.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Burg",
    short_name: "Burg",
    description: "A wiki and database workspace shaped like a small city.",
    start_url: "/city",
    display: "standalone",
    background_color: "#f2efe4",
    theme_color: "#f2efe4",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
