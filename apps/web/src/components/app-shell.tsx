"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { GithubLoginButton } from "./github-login-button";

// Top navigation bar, shared across every page. Sticky to the top so it
// stays visible while scrolling long lists / findings.
//
// Three of the four nav links (Repositories / Security / Automation) point at
// routes that don't have real backend endpoints yet. We render them anyway so
// the visual shell matches the design -- the target pages show a clean
// "coming soon" empty state, not a 404.
const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/repositories", label: "Repositories" },
  { href: "/security", label: "Security" },
  { href: "/automation", label: "Automation" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const active = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-50 bg-surface border-b border-border-dark">
        <div className="flex justify-between items-center h-16 max-w-container-max mx-auto px-margin-page">
          <div className="flex items-center gap-6 h-full">
            <span className="font-headline-md text-headline-md font-bold text-text-primary tracking-tight">
              AI Code Review &amp; DevSecOps
            </span>
            <nav className="hidden md:flex items-center gap-2 h-full">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-3 h-full flex items-center rounded transition-colors ${
                    active(item.href)
                      ? "text-text-primary bg-surface-container-high"
                      : "text-text-muted hover:text-text-primary hover:bg-surface-container-highest"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <GithubLoginButton />
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}