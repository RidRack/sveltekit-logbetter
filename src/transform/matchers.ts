import type { AstNode } from "./walker.js";

/**
 * Returns the console method name (e.g. "log", "warn") if `node` is a
 * direct `console.X(...)` call expression. Returns `null` otherwise.
 *
 * We deliberately do NOT track scopes: a user that shadows `console` is on
 * their own. In practice this is vanishingly rare and trying to handle it
 * forces a real scope analyzer.
 */
export function consoleMethod(node: AstNode): string | null {
  if (node.type !== "CallExpression") return null;
  const callee = node.callee as AstNode | undefined;
  if (!callee || callee.type !== "MemberExpression") return null;
  if (callee.computed) return null;
  const object = callee.object as AstNode | undefined;
  const property = callee.property as AstNode | undefined;
  if (!object || object.type !== "Identifier") return null;
  if ((object as unknown as { name?: string }).name !== "console") return null;
  if (!property || property.type !== "Identifier") return null;
  const name = (property as unknown as { name?: string }).name;
  return typeof name === "string" ? name : null;
}
