/**
 * Build-time globals, substituted by esbuild (`define` in scripts/build.mjs).
 *
 * There is no bundler-injected `import.meta.env` here any more: every global the
 * client code can see is declared in this file, so a typo becomes a type error
 * instead of an `undefined` that silently disables a check.
 */

/** `true` while `npm run dev` is running, `false` in `npm run build` output. */
declare const __DEV__: boolean;

/** Version from package.json, shown in the footer. */
declare const __APP_VERSION__: string;
