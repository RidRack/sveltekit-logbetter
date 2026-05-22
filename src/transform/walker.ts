/**
 * Tiny ESTree walker. Visits every node in a depth-first order, calling
 * `enter` before descending and `leave` after. Knows nothing about scopes;
 * the transformer pattern-matches `console.X(...)` calls directly.
 */

export interface AstNode {
  type: string;
  start?: number;
  end?: number;
  loc?: { start: { line: number; column: number }; end: { line: number; column: number } };
  [k: string]: unknown;
}

export interface WalkCallbacks {
  enter?: (node: AstNode, parent: AstNode | null) => void | "skip";
  leave?: (node: AstNode, parent: AstNode | null) => void;
}

export function walk(root: AstNode, cb: WalkCallbacks): void {
  visit(root, null, cb);
}

function visit(node: AstNode, parent: AstNode | null, cb: WalkCallbacks): void {
  if (!node || typeof node !== "object" || typeof node.type !== "string") return;
  const r = cb.enter?.(node, parent);
  if (r !== "skip") {
    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "type" || key === "start" || key === "end") continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const c of child) {
          if (c && typeof c === "object" && typeof (c as AstNode).type === "string") {
            visit(c as AstNode, node, cb);
          }
        }
      } else if (child && typeof child === "object" && typeof (child as AstNode).type === "string") {
        visit(child as AstNode, node, cb);
      }
    }
  }
  cb.leave?.(node, parent);
}
