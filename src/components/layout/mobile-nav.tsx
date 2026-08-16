"use client";

import { useState, useRef, useEffect } from "react";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";

/**
 * Mobile hamburger menu. Renders a button (visible below `sm`) that
 * toggles a dropdown panel with the same nav links as the desktop bar.
 * Closes on outside click, route change, or Escape.
 */
export function MobileNav({
  links,
  signOutLabel,
  signOutAction,
  locale,
  myAccountLabel,
  myAccountHref,
  displayName,
}: {
  links: { href: string; label: string; badge?: number | null }[];
  signOutLabel: string;
  signOutAction: (locale: AppLocale) => Promise<void>;
  locale: AppLocale;
  myAccountLabel: string;
  myAccountHref: string;
  displayName: string | null;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative sm:hidden">
      <button
        type="button"
        aria-label="Menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#E3DED2] text-[#232922] hover:bg-[#F5F2EA]"
      >
        {open ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        )}
      </button>

      {open ? (
        <div className="absolute right-0 top-11 z-50 w-60 overflow-hidden rounded-xl border border-[#E3DED2] bg-white shadow-lg">
          <div className="flex flex-col py-1">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="flex items-center justify-between px-4 py-2.5 text-sm font-medium text-[#232922] hover:bg-[#F5F2EA]"
              >
                <span>{link.label}</span>
                {link.badge && link.badge > 0 ? (
                  <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[#C4622D] px-1.5 text-[11px] font-bold leading-none text-white">
                    {link.badge}
                  </span>
                ) : null}
              </Link>
            ))}
            <div className="my-1 border-t border-[#E3DED2]" />
            <Link
              href={myAccountHref}
              onClick={() => setOpen(false)}
              className="px-4 py-2.5 text-sm font-medium text-[#232922] hover:bg-[#F5F2EA]"
            >
              {displayName ?? myAccountLabel}
            </Link>
            <form action={signOutAction.bind(null, locale)}>
              <button
                type="submit"
                className="w-full px-4 py-2.5 text-left text-sm font-medium text-[#232922] hover:bg-[#F5F2EA]"
              >
                {signOutLabel}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
