"use client";

import { useEffect } from "react";

const DEFAULT_MESSAGE = "You have unsaved changes. Leave this page?";

/**
 * Guards against losing unsaved form changes.
 *
 * When `isDirty` is true:
 *   (a) registers a `beforeunload` handler so the browser prompts on
 *       tab close / reload, and
 *   (b) intercepts in-app navigation: link clicks and `popstate` (back/
 *       forward) trigger a native `window.confirm` using `message`.
 *
 * When `isDirty` becomes false the listeners are torn down, so a
 * successful submit deactivates the guard.
 */
export function useUnsavedChangesGuard(isDirty: boolean, message: string = DEFAULT_MESSAGE) {
  useEffect(() => {
    if (!isDirty) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = message;
    };

    const isInternalLink = (anchor: HTMLAnchorElement): boolean => {
      if (anchor.hasAttribute("download")) return false;
      if (anchor.target === "_blank") return false;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
        return false;
      }
      try {
        const url = new URL(href, window.location.href);
        return url.origin === window.location.origin;
      } catch {
        return false;
      }
    };

    const handleClick = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement | null)?.closest?.("a") as HTMLAnchorElement | null;
      if (!anchor || !isInternalLink(anchor)) return;
      const ok = window.confirm(message);
      if (!ok) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };

    const handlePopState = () => {
      const ok = window.confirm(message);
      if (!ok) {
        window.history.pushState(null, "", window.location.href);
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleClick, true);
    // Push a sentinel entry so back-button presses surface as popstate.
    window.history.pushState({ __unsavedGuard: true }, "", window.location.href);
    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleClick, true);
      window.removeEventListener("popstate", handlePopState);
    };
  }, [isDirty, message]);
}
