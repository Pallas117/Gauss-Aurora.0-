/// <reference types="vite/client" />

/**
 * Vite does not define `process` in the browser. It exists only when src code
 * runs under Node (Jest, tsx scripts), so guard every read with
 * `typeof process !== "undefined"`. Tests get the full Node type instead
 * (tsconfig.test.json).
 */
declare const process: { readonly env: Readonly<Record<string, string | undefined>> } | undefined;
