import { useEffect } from "react";

// Keep keyboard navigation inside an open sheet and return focus on close.
export default function useDialogFocus(rootRef, active, selector) {
  useEffect(() => {
    if (!active) return;
    const panel = selector ? rootRef.current?.querySelector(selector) : rootRef.current;
    if (!panel) return;
    const previous = document.activeElement;
    const focusable = () => [...panel.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"]')].filter((element) => element.getClientRects().length);
    if (!panel.contains(document.activeElement)) focusable()[0]?.focus({ preventScroll: true });
    const onKey = (event) => {
      if (event.key !== "Tab") return;
      const elements = focusable();
      const first = elements[0], last = elements[elements.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if ((panel.contains(document.activeElement) || document.activeElement === document.body) && previous?.isConnected && previous.getClientRects().length) previous.focus({ preventScroll: true });
    };
  }, [rootRef, active, selector]);
}
