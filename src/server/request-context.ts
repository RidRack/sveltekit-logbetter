import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  id: string;
  method: string;
  url: string;
  start: number;
}

export const requestStorage = new AsyncLocalStorage<RequestContext>();

let counter = 0;

export function nextRequestId(): string {
  counter = (counter + 1) | 0;
  return `r${Date.now().toString(36)}${counter.toString(36)}`;
}
