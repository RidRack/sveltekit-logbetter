import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = () => {
  const inner = new Error("upstream timeout");
  const outer = new Error("failed to fetch quote", { cause: inner });
  console.error(outer);
  console.warn("about to retry...");
  console.log("retry succeeded");
  return {};
};
