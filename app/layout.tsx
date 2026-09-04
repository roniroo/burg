import type { Metadata, Viewport } from "next";
import { Inter, Pixelify_Sans, Silkscreen } from "next/font/google";
import "./globals.css";

// Chrome, labels, buttons.
const silkscreen = Silkscreen({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-silkscreen",
  display: "swap",
});

// Headings.
const pixelify = Pixelify_Sans({
  subsets: ["latin"],
  variable: "--font-pixelify",
  display: "swap",
});

// Every paragraph, and all document body copy.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Burg",
  description: "A wiki and database workspace shaped like a small city.",
};

export const viewport: Viewport = {
  themeColor: "#f2efe4",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${silkscreen.variable} ${pixelify.variable} ${inter.variable}`}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
