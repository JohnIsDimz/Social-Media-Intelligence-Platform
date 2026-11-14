/// <reference types="vite/client" />

/**
 * Vite's client types.
 *
 * `import.meta.env.DEV` is used to refuse service-worker registration in
 * development. Without this reference TypeScript has no type for `import.meta`,
 * and the check that stops a stale cached build from rendering would fail the
 * type check instead of the stale build.
 */

/**
 * Version injected by `vite.config.ts` at build time (from package.json).
 * Declared here so TypeScript accepts the global in `App.tsx`.
 */
declare const __APP_VERSION__: string;
