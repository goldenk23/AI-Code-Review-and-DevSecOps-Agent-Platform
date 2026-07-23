"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { GithubLoginButton } from "./github-login-button";
import { MenuIcon, CloseIcon } from "./icons";

// Top navigation bar, shared across every page. Sticky to the top so it
// stays visible while scrolling long lists / findings.
//
// The active nav item uses a 2px bottom-border underline (the Stitch designs'
// convention) rather than a filled pill. The three non-Dashboard routes
// (Repositories / Security / Automation) point at pages that render a
// "coming soon" / placeholder UI so the nav never 404s.
//
// On mobile (<768px) the horizontal links collapse into a hamburger menu that
// drops down a full-width panel. The panel closes on navigation (pathname
// change) so the user never has to manually dismiss it after tapping a link.
const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/repositories", label: "Repositories" },
  { href: "/security", label: "Security" },
  { href: "/automation", label: "Automation" },
  { href: "/dead-jobs", label: "Dead Letters" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const active = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-50 bg-surface border-b border-border-dark">
        <div className="flex justify-between items-center h-16 max-w-container-max mx-auto px-margin-page">
          <div className="flex items-center gap-6 h-full">
            <span className="font-headline-md text-headline-md font-bold text-text-primary tracking-tight">
              AI Code Review & DevSecOps
            </span>
            <nav className="hidden md:flex items-center gap-2 h-full">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`h-full flex items-center px-3 transition-colors duration-200 ease-in-out ${
                    active(item.href)
                      ? "text-white border-b-2 border-accent -mb-px"
                      : "text-text-muted hover:text-text-primary hover:bg-surface-container-highest rounded"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <GithubLoginButton />
            {/* Hamburger toggle -- only visible below md. aria-expanded reflects
                open state for screen readers; aria-controls points at the panel. */}
            <button
              type="button"
              className="md:hidden text-text-muted hover:text-text-primary p-1 rounded hover:bg-surface-container-high transition-colors"
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileOpen}
              aria-controls="mobile-nav"
              onClick={() => setMobileOpen((v) => !v)}
            >
              {mobileOpen ? <CloseIcon className="size-6" /> : <MenuIcon className="size-6" />}
            </button>
          </div>
        </div>

        {/* Mobile nav panel -- slides down under the header. Closes on link
            click via the onClick handler on each Link. */}
        {mobileOpen && (
          <nav
            id="mobile-nav"
            className="md:hidden border-t border-border-dark bg-surface flex flex-col"
          >
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`px-margin-page py-3 border-b border-border-dark last:border-b-0 transition-colors ${
                  active(item.href)
                    ? "text-accent bg-accent/5"
                    : "text-text-muted hover:text-text-primary hover:bg-surface-container-high"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        )}
      </header>
      {children}
    </div>
  );
}