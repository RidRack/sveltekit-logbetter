import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = () => {
  console.log("a log message");
  console.info("an info message");
  console.debug("a debug message");
  console.warn("a warning");
  console.trace("a trace (with stack)");

  console.group("grouped logs");
  console.log("inside group A");
  console.log("inside group B");
  console.groupEnd();

  console.table([
    { name: "Alice", role: "admin" },
    { name: "Bob", role: "viewer" },
  ]);

  return {};
};
