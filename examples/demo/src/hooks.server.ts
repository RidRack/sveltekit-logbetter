import { sequence } from "@sveltejs/kit/hooks";

import { logbetterHook } from "sveltekit-logbetter/hooks";

export const handle = sequence(logbetterHook());
