/**
 * Guard: every spec vitest collects must live inside a tsconfig project.
 *
 * A spec that vitest runs but no project includes is invisible to both gates
 * that claim to cover it. `pnpm typecheck:test` never type-checks it, and
 * `pnpm lint:full` cannot lint it at all — the type-aware parser fatals with
 * `"parserOptions.project" has been provided for @typescript-eslint/parser. The
 * file was not found in any of the provided project(s)`. The spec still runs in
 * CI, so it reads as covered while two of the three gates are blind to it.
 *
 * The way a spec falls out is not a glob mistake, and editing `include` does not
 * fix it. TypeScript applies an extension priority inside the `.ts` / `.tsx` /
 * `.d.ts` group when it expands a project's include patterns: when `foo.ts` and
 * `foo.tsx` sit in one directory, the `.tsx` is dropped. Measured on this repo,
 * replacing `"include": ["src"]` with explicit `src/**` `.ts` + `.tsx` patterns
 * resolves to the identical file list, and so does naming the `.tsx` literally
 * in `include`. The only available fix is to not have the colliding pair, which
 * is why the last case below names the pair rather than pointing at a config.
 *
 * Scope is `src/` and `scripts/`, which is the whole vitest-collected set: the
 * only other specs live under `tests/e2e/`, which `vite.config.ts` excludes from
 * vitest and Playwright owns. Those two trees are also exactly what
 * `pnpm lint:full` globs and what `tsconfig.test.json` / `tsconfig.eslint.json`
 * include.
 *
 * Falsifiable per ADR 0015: restoring
 * `Inspector/__tests__/deviceLayoutRegistry.spec.tsx` next to its `.ts` twin
 * reds three of the four cases here.
 */

import { readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { flattenDiagnosticMessageText, parseJsonConfigFileContent, readConfigFile, sys } from 'typescript';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../..');

function collectSpecFiles(relativeRoot: string): string[] {
    const found: string[] = [];
    const walk = (dirAbs: string): void => {
        for (const entry of readdirSync(dirAbs, { withFileTypes: true })) {
            const entryAbs = join(dirAbs, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules') {
                    continue;
                }
                walk(entryAbs);
                continue;
            }
            if (entry.name.endsWith('.spec.ts') || entry.name.endsWith('.spec.tsx')) {
                found.push(entryAbs);
            }
        }
    };
    walk(join(repoRoot, relativeRoot));
    return found.sort();
}

/** Absolute file list a tsconfig project resolves to, `extends` chain included. */
function projectFiles(configFileName: string): Set<string> {
    const configPath = join(repoRoot, configFileName);
    const read = readConfigFile(configPath, sys.readFile);
    if (read.error) {
        throw new Error(
            `Could not read ${configFileName}: ${flattenDiagnosticMessageText(read.error.messageText, ' ')}`
        );
    }
    const parsed = parseJsonConfigFileContent(read.config, sys, dirname(configPath));
    return new Set(parsed.fileNames.map((fileName) => resolve(fileName)));
}

function missingFrom(configFileName: string, specFiles: string[]): string[] {
    const files = projectFiles(configFileName);
    return specFiles.filter((specFile) => !files.has(specFile)).map((specFile) => relative(repoRoot, specFile));
}

const srcSpecs = collectSpecFiles('src');
const scriptSpecs = collectSpecFiles('scripts');

describe('every collected spec is inside a tsconfig project', () => {
    it('walks a real spec inventory, so an empty walk cannot pass the cases below vacuously', () => {
        expect(srcSpecs.length).toBeGreaterThan(1000);
        expect(scriptSpecs.length).toBeGreaterThan(0);
    });

    it('type-checks every src spec under tsconfig.test.json (`pnpm typecheck:test`)', () => {
        expect(missingFrom('tsconfig.test.json', srcSpecs)).toEqual([]);
    });

    it('lints every src and scripts spec under tsconfig.eslint.json (`pnpm lint:full`)', () => {
        expect(missingFrom('tsconfig.eslint.json', [...srcSpecs, ...scriptSpecs])).toEqual([]);
    });

    it('has no .ts/.tsx spec pair sharing a basename, the one way a spec falls out of every project', () => {
        const byBasename = new Map<string, string[]>();
        for (const specFile of [...srcSpecs, ...scriptSpecs]) {
            const key = specFile.replace(/\.tsx?$/, '');
            byBasename.set(key, [...(byBasename.get(key) ?? []), relative(repoRoot, specFile)]);
        }
        const collisions = [...byBasename.values()].filter((paths) => paths.length > 1);
        expect(collisions).toEqual([]);
    });
});
