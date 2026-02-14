/// <reference lib="webworker" />
export {};
declare global {
  interface ServiceWorkerGlobalScope {
    __SW_MANIFEST: (import("serwist").PrecacheEntry | string)[] | undefined;
  }
}
