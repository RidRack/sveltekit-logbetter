import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ url }) => {
  console.log("home page loaded for", url.href);
  console.info("if you can read this in the browser console, it works");
  return { message: "hello from the server" };
};
