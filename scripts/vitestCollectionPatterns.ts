/**
 * The runner collection contract the Vitest collection-scope guard and the semantic review screen
 * agree on.
 *
 * Both consumers answer the same question — which paths does a runner collect as a test — so the
 * patterns and directories live here rather than in either consumer. Importing this module has no
 * side effects: the guard runs only when its own entry point is executed.
 */

/** Mirrors vitest's default `include` (`**\/*.{test,spec}.?(c|m)[jt]s?(x)`). */
export const specFilePattern = /\.(?:test|spec)\.(?:c|m)?[jt]sx?$/;

/** Mirrors the `**\/*.e2e.spec.*` entry in the config's `exclude`. */
export const e2eSpecPattern = /\.e2e\.spec\./;

/**
 * The directory prefixes `vite.config.ts` adds to `exclude`, which stop the root Vitest run from
 * collecting a spec there. `**\/*.e2e.spec.*` is `e2eSpecPattern`; the rest are these prefixes.
 * `tests/e2e` and `server` are excluded from Vitest because Playwright and node:test own them.
 */
export const vitestExcludePrefixes: readonly string[] = [
    'dist/',
    'electron/out/',
    'server/',
    '.agents/worktrees/',
    'tests/e2e/',
];

/** Playwright's `testDir` (`playwright.config.ts`): the only directory it runs specs from. */
export const playwrightTestDir = 'tests/e2e';

/** Playwright's `testIgnore` entry excluding any `__tests__` directory (`playwright.config.ts`). */
export const playwrightTestIgnorePattern = /(?:^|\/)__tests__\//u;

/** Exact server runner command from `server/package.json`. */
export const serverTestCommand = 'tsx --test __tests__/*.spec.ts';

/** The directory the server command's non-recursive glob points at (`server/__tests__`). */
export const serverTestDirectory = 'server/__tests__';

/** Whether Vitest's root run collects the path (`vite.config.ts` include and exclude). */
export function isVitestCollected(path: string): boolean {
    if (!specFilePattern.test(path)) {
        return false;
    }
    if (e2eSpecPattern.test(path)) {
        return false;
    }
    return !vitestExcludePrefixes.some((prefix) => path.startsWith(prefix));
}

/** Whether Playwright collects the path (`playwright.config.ts` testDir and testIgnore). */
export function isPlaywrightCollected(path: string): boolean {
    // Playwright's default testMatch carries the same `.spec.*`/`.test.*` suffix as `specFilePattern`.
    if (!path.startsWith(`${playwrightTestDir}/`)) {
        return false;
    }
    if (playwrightTestIgnorePattern.test(path)) {
        return false;
    }
    return specFilePattern.test(path);
}

/** Whether the server's node:test command collects the path (`server/package.json`). */
export function isNodeTestCollected(path: string): boolean {
    if (!path.startsWith(`${serverTestDirectory}/`)) {
        return false;
    }
    const remainder = path.slice(serverTestDirectory.length + 1);
    // The `__tests__/*.spec.ts` glob is non-recursive: it names direct children only.
    return !remainder.includes('/') && remainder.endsWith('.spec.ts');
}
