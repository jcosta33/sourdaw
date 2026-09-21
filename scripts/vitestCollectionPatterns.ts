/**
 * The collection contract the Vitest collection-scope guard and the semantic review screen agree on.
 *
 * Both consumers answer the same question — which paths does a runner collect as a test — so the two
 * patterns live here rather than in either consumer. Importing this module has no side effects: the
 * guard runs only when its own entry point is executed.
 */

/** Mirrors vitest's default `include` (`**\/*.{test,spec}.?(c|m)[jt]s?(x)`). */
export const specFilePattern = /\.(?:test|spec)\.(?:c|m)?[jt]sx?$/;

/** Mirrors the `**\/*.e2e.spec.*` entry in the config's `exclude`. */
export const e2eSpecPattern = /\.e2e\.spec\./;
