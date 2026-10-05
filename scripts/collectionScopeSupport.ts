/**
 * Pure parts of `checkVitestCollectionScope.ts`, kept apart so a spec can import them: the gate
 * itself runs on import and exits the process.
 */

import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** `<literal directory>/**`: the only exclude shape `vitestExcludePrefixes` mirrors. */
const directoryExcludeGlob = /^([^*?[\]{}!]+\/)\*\*$/u;

export type ExcludeClassification = {
    /** Directory prefixes in the `dir/` form `vitestExcludePrefixes` uses. */
    prefixes: string[];
    /** Entries that are neither a known file-level glob nor a plain directory prefix. */
    unrecognised: string[];
};

/**
 * Sorts every resolved `exclude` entry into a known file-level glob (ignored here, declared by the
 * caller), a plain directory prefix, or unrecognised. Nothing is dropped silently: a shape this does
 * not understand (`dir/**\/*`, a bare `dir`) can exclude specs that `isVitestCollected` still reports.
 */
export function classifyExcludeGlobs(
    globs: readonly string[],
    knownFileGlobs: readonly string[]
): ExcludeClassification {
    const known = new Set(knownFileGlobs);
    const prefixes: string[] = [];
    const unrecognised: string[] = [];
    for (const glob of globs) {
        if (known.has(glob)) {
            continue;
        }
        const prefix = directoryExcludeGlob.exec(glob)?.[1];
        if (prefix === undefined) {
            unrecognised.push(glob);
            continue;
        }
        prefixes.push(prefix);
    }
    return { prefixes, unrecognised };
}

/** One failure line per unrecognised entry or one-sided prefix; each names the entry or prefix. */
export function describeExcludeMirrorDrift(
    globs: readonly string[],
    knownFileGlobs: readonly string[],
    mirrorPrefixes: readonly string[]
): string[] {
    const { prefixes, unrecognised } = classifyExcludeGlobs(globs, knownFileGlobs);
    const mirrorSet = new Set(mirrorPrefixes);
    const configSet = new Set(prefixes);
    return [
        ...unrecognised.map(
            (glob) =>
                `  ✗ vite.config.ts excludes '${glob}', which is neither a known file-level glob nor a '<dir>/**' prefix; vitestExcludePrefixes cannot mirror it.`
        ),
        ...prefixes
            .filter((prefix) => !mirrorSet.has(prefix))
            .map(
                (prefix) =>
                    `  ✗ vite.config.ts excludes '${prefix}**' but vitestExcludePrefixes has no '${prefix}' entry (scripts/vitestCollectionPatterns.ts).`
            ),
        ...mirrorPrefixes
            .filter((prefix) => !configSet.has(prefix))
            .map(
                (prefix) =>
                    `  ✗ vitestExcludePrefixes lists '${prefix}' but vite.config.ts has no '${prefix}**' entry in test.exclude.`
            ),
    ];
}

/** The agent directories among the mirror prefixes, without the trailing slash. */
export function agentExcludeRoots(mirrorPrefixes: readonly string[]): string[] {
    return mirrorPrefixes.filter((prefix) => prefix.startsWith('.agents/')).map((prefix) => prefix.slice(0, -1));
}

export const fixtureDirectoryPrefix = 'collection-scope-guard-';

export type PlantedFixture = {
    root: string;
    directory: string;
    specPath: string;
};

export type WriteSpec = (absoluteSpecPath: string, source: string) => void;

function writeSpecFile(absoluteSpecPath: string, source: string): void {
    writeFileSync(absoluteSpecPath, source, 'utf8');
}

/**
 * Writes a real spec into a throwaway directory under the specified root, so the
 * absence assertion has a subject on a clean clone. The directory name is unique
 * per process: two runs in the same checkout must not delete each other's fixture.
 * A failure after the directory exists removes it before rethrowing, because the
 * caller never receives the fixture it would have cleaned.
 */
export function plantWorktreeFixture(
    repoRoot: string,
    root: string,
    writeSpec: WriteSpec = writeSpecFile
): PlantedFixture {
    const absoluteWorktreeRoot = join(repoRoot, root);
    mkdirSync(absoluteWorktreeRoot, { recursive: true });
    const directory = mkdtempSync(join(absoluteWorktreeRoot, fixtureDirectoryPrefix));
    try {
        const specDirectory = join(directory, 'src');
        mkdirSync(specDirectory);
        const absoluteSpecPath = join(specDirectory, 'collectionScopeGuard.spec.ts');
        writeSpec(
            absoluteSpecPath,
            [
                "import { describe, expect, it } from 'vitest';",
                '',
                "describe('vitest collection scope guard fixture', () => {",
                "    it('must never be collected — it stands in for an agent worktree', () => {",
                `        expect.unreachable('a spec under ${root}/ was collected by the root run');`,
                '    });',
                '});',
                '',
            ].join('\n')
        );
        return {
            root,
            directory,
            specPath: relative(repoRoot, absoluteSpecPath).split(sep).join('/'),
        };
    } catch (error) {
        rmSync(directory, { recursive: true, force: true });
        throw error;
    }
}

/** `<root>/<name>` for every fixture directory currently under the roots; a missing root has none. */
export function listFixtureDirectories(repoRoot: string, roots: readonly string[]): string[] {
    return roots.flatMap((root) => {
        let names: string[];
        try {
            names = readdirSync(join(repoRoot, root));
        } catch {
            return [];
        }
        return names.filter((name) => name.startsWith(fixtureDirectoryPrefix)).map((name) => `${root}/${name}`);
    });
}

/** Fixture directories present after the run that were not there before it; a concurrent older run's are not ours. */
export function findLeftoverFixtures(before: readonly string[], after: readonly string[]): string[] {
    const beforeSet = new Set(before);
    return after.filter((entry) => !beforeSet.has(entry));
}
