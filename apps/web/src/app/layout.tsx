import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "./providers";
// globals.css MUST be imported by the root layout -- it's the only place
// `@import "tailwindcss"` + the `@theme` token block live. Without this
// import, Tailwind's PostCSS plugin never runs on the file, the utility
// classes used across every component have NO matching CSS rules, and the
// whole dashboard renders as unstyled HTML. This was the root cause of the
// "no CSS" symptom.
import "./globals.css";

// Geist must be loaded via next/font so it gets self-hosted (no Google Fonts
// CDN call at runtime). We expose the fonts as CSS variables on <html> so the
// @theme tokens in globals.css (--font-geist-sans / --font-geist-mono) resolve.
const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

// IMPORTANT (Next 16): viewport / themeColor must live in a SEPARATE `viewport`
// export, NOT inside `metadata`. metadata-only-in-Server-Components is fine here
// because layout.tsx is a Server Component.
export const viewport: Viewport = {
  themeColor: "#131313",
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
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200"
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}