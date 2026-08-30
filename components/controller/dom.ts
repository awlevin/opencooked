// Tiny DOM helpers. No framework — the controller is a handful of screens
// driven imperatively, mounted into React by app/join/page.tsx.
//
// Nothing here runs at import time, so this module is safe to pull into a
// server-rendered bundle.

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}
