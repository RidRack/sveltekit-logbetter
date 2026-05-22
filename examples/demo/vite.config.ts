import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

import { sveltekitLogbetter } from "sveltekit-logbetter/vite";

export default defineConfig({
  plugins: [
    sveltekit(),
    sveltekitLogbetter({
      editor: "vscode",
    }),
  ],
});
