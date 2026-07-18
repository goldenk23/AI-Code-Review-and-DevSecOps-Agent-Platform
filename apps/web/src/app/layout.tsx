import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "./providers";

// Geist must be loaded via next/font so it gets self-hosted (no Google Fonts
// CDN call at runtime). We expose the fonts as CSS variables on <html> so the
// @theme tokens in globals.css (--font-geist-sans / --font-geist-mono) resolve.
const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

// IMPORTANT (Next 16): viewport / themeColor must live in a SEPARATE `viewport`
// export, NOT inside `metadata`. metadata-only-in-Server-Components is fine here
// because layout.tsx is a Server Component.
export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: "AI Code Review & DevSecOps",
  description: "Monitor AI code review and security analysis runs across your repositories.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`} data-theme="dark">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}