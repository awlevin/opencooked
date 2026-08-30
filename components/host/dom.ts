// Scoped element lookup. The host app is mounted into a React-rendered
// subtree, so every module queries inside that root instead of the document —
// two mounts (React StrictMode) never fight over the same global ids.

export function q<T extends Element>(root: ParentNode, selector: string): T {
  const node = root.querySelector<T>(selector);
  if (!node) throw new Error(`host: missing ${selector}`);
  return node;
}
