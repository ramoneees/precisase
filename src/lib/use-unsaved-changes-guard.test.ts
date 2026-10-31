import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUnsavedChangesGuard } from "./use-unsaved-changes-guard";

const MESSAGE = "You have unsaved changes. Leave this page?";

function dispatchBeforeUnload() {
  const event = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

function clickInternalLink(href: string) {
  const anchor = document.createElement("a");
  anchor.setAttribute("href", href);
  document.body.appendChild(anchor);
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, composed: true });
  act(() => {
    anchor.dispatchEvent(event);
  });
  document.body.removeChild(anchor);
  return event;
}

function pressBack() {
  act(() => {
    window.dispatchEvent(new Event("popstate"));
  });
}

describe("useUnsavedChangesGuard", () => {
  beforeEach(() => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("blocks beforeunload and asks before in-app navigation while dirty", () => {
    renderHook(() => useUnsavedChangesGuard(true, MESSAGE));

    const unloadEvent = dispatchBeforeUnload();
    expect(unloadEvent.defaultPrevented).toBe(true);

    const clickEvent = clickInternalLink("/posts");
    expect(window.confirm).toHaveBeenCalledWith(MESSAGE);
    // User confirmed — the browser may proceed with the navigation.
    expect(clickEvent.defaultPrevented).toBe(false);
  });

  it("blocks beforeunload and cancels in-app navigation when the user declines", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderHook(() => useUnsavedChangesGuard(true, MESSAGE));

    const unloadEvent = dispatchBeforeUnload();
    expect(unloadEvent.defaultPrevented).toBe(true);

    const clickEvent = clickInternalLink("/posts");
    expect(clickEvent.defaultPrevented).toBe(true);
  });

  it("asks before going back to a previous page while dirty", () => {
    renderHook(() => useUnsavedChangesGuard(true, MESSAGE));

    pressBack();
    expect(window.confirm).toHaveBeenCalledWith(MESSAGE);
  });

  it("does not warn when the form is clean", () => {
    renderHook(() => useUnsavedChangesGuard(false, MESSAGE));

    const unloadEvent = dispatchBeforeUnload();
    expect(unloadEvent.defaultPrevented).toBe(false);

    const clickEvent = clickInternalLink("/posts");
    expect(window.confirm).not.toHaveBeenCalled();
    expect(clickEvent.defaultPrevented).toBe(false);

    pressBack();
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("tears down listeners on unmount", () => {
    const { unmount } = renderHook(() => useUnsavedChangesGuard(true, MESSAGE));
    unmount();

    const unloadEvent = dispatchBeforeUnload();
    expect(unloadEvent.defaultPrevented).toBe(false);
    expect(window.confirm).not.toHaveBeenCalled();
  });
});
