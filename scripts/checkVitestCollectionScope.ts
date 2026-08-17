#!/usr/bin/env node
/**
 * `pnpm test:collection-scope` — proves that a bare `vitest run` at the repo root
 * collects the main tree's specs and nothing else.
 *
 * Why this exists. `vite.config.ts` excluded `.claude/**` in order to keep local
 * agent worktrees out of the run. Agent worktrees live at `.agents/worktrees/`;
 * they moved there and the exclusion did not follow. The pattern matched nothing
 * for four months, and nothing noticed, because a config exclusion has no verdict
 * of its own — it just quietly stops applying. Measured on a machine with 18 live
 * lanes, the root run collected 62,745 spec files instead of 3,269: a lane's own
 * verification was running seventeen other lanes' code, which is how one lane ends
 * up reporting another lane's failing spec as its own.
 *
 * How it can fail (ADR 0015). Three independent verdicts, none of them vacuous:
 *
 *  1. **Absence, with the subject planted.** The check writes a real spec file into
 *     a throwaway directory under `.agents/worktrees/` before collecting, so the
 *     "no worktree paths were collected" assertion always has something it could
 *     have caught. A clean clone has no worktrees; without the fixture this
 *     assertion would pass by having nothing to look at, which is the blind shape
 *     ADR 0015 rule 4 names.
 *  2. **Presence, from an independent source.** The collected set is compared for
 *     exact equality against a filesystem walk of the collectable roots below. The
 *     two sides are sourced differently — vitest's glob resolution versus a plain
 *     directory walk — so neither can launder the other (rule 3). This side is what
 *     reds if an over-broad exclusion, or a `--dir` / `include` allowlist, silently
 *     drops specs that used to run: `scripts/__tests__/` holds four of them and
 *     lives outside `src`.
 *  3. **Registry, not list.** `collectableRoots` is the enumeration. A spec added
 *     anywhere inside a declared root is covered automatically; a new root is a
 *     deliberate edit here, and until it is made the equality fails loudly rather
 *     than the specs silently not running.
 *
 * Exit code 0 = collection scope is correct, 1 = drift (with a per-check report).
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Directories a root `vitest run` is meant to collect from. This is the population
 * the equality check enumerates; it is not a sample.
 *
 * `tests/e2e` is deliberately absent — those are Playwright specs, excluded by
 * `vite.config.ts` and run by `pnpm test:e2e <spec>`.
 */
const collectableRoots = ['src', 'scripts', 'electron', 'server'] as const;

/** The directory the exclusion under test is responsible for. */
const worktreeRoot = '.agents/worktrees';

/** Mirrors vitest's default `include` (`**\/*.{test,spec}.?(c|m)[jt]s?(x)`). */
const specFilePattern = /\.(?:test|spec)\.(?:c|m)?[jt]sx?$/;

/** Mirrors the `**\/*.e2e.spec.*` entry in the config's `exclude`. */
const e2eSpecPattern = /\.e2e\.spec\./;

/** Directories a walk must not descend into, matching the config's `exclude`. */
const skippedDirectories = new Set(['node_modules', 'dist', 'coverage', 'target']);

/**
 * Build output the config excludes by path rather than by name. `pnpm desktop:dev`
 * compiles `electron/` into `electron/out/`, specs included, so without this the
 * walk and the run would both pick up a second, compiled copy of every Electron
 * spec on any machine that has run the shell.
 */
const skippedPaths = new Set(['electron/out']);

function isCollectableSpec(relativePath: string): boolean {
    if (!specFilePattern.test(relativePath)) {
        return false;
    }
    return !e2eSpecPattern.test(relativePath);
}

function walkForSpecs(absoluteDirectory: string, found: string[]): void {
    let entries;
    try {
        entries = readdirSync(absoluteDirectory, { withFileTypes: true });
    } catch {
        return;
    }

    for (const entry of entries) {
        const absoluteEntry = join(absoluteDirectory, entry.name);
        if (entry.isDirectory()) {
            const relativeDirectory = relative(repoRoot, absoluteEntry).split(sep).join('/');
            if (skippedDirectories.has(entry.name) || skippedPaths.has(relativeDirectory)) {
                continue;
            }
            walkForSpecs(absoluteEntry, found);
            continue;
        }
        if (!entry.isFile()) {
            continue;
        }
        const relativePath = relative(repoRoot, absoluteEntry).split(sep).join('/');
        if (isCollectableSpec(relativePath)) {
            found.push(relativePath);
        }
    }
}

function enumerateExpectedSpecs(): string[] {
    const found: string[] = [];
    for (const root of collectableRoots) {
        walkForSpecs(join(repoRoot, root), found);
    }
    return found.sort();
}

type PlantedFixture = {
    directory: string;
    specPath: string;
};

/**
 * Writes a real spec into a throwaway directory under `.agents/worktrees/`, so the
 * absence assertion has a subject on a clean clone. The directory name is unique
 * per process: two runs in the same checkout must not delete each other's fixture.
 */
function plantWorktreeFixture(): PlantedFixture {
    const absoluteWorktreeRoot = join(repoRoot, worktreeRoot);
    mkdirSync(absoluteWorktreeRoot, { recursive: true });
    const directory = mkdtempSync(join(absoluteWorktreeRoot, 'collection-scope-guard-'));
    const specDirectory = join(directory, 'src');
    mkdirSync(specDirectory);
    const absoluteSpecPath = join(specDirectory, 'collectionScopeGuard.spec.ts');
    writeFileSync(
        absoluteSpecPath,
        [
            "import { describe, expect, it } from 'vitest';",
            '',
            "describe('vitest collection scope guard fixture', () => {",
            "    it('must never be collected — it stands in for an agent worktree', () => {",
            "        expect.unreachable('a spec under .agents/worktrees/ was collected by the root run');",
            '    });',
            '});',
            '',
        ].join('\n'),
        'utf8'
    );
    return {
        directory,
        specPath: relative(repoRoot, absoluteSpecPath).split(sep).join('/'),
    };
}

function collectWithVitest(): string[] {
    const stdout = execFileSync('pnpm', ['exec', 'vitest', 'list', '--filesOnly'], {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'inherit'],
    });
    return stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => specFilePattern.test(line))
        .sort();
}

function formatSample(paths: string[], limit = 5): string {
    const sample = paths.slice(0, limit).map((path) => `      ${path}`);
    if (paths.length > limit) {
        sample.push(`      … and ${paths.length - limit} more`);
    }
    return sample.join('\n');
}

function main(): number {
    const failures: string[] = [];
    const fixture = plantWorktreeFixture();

    let collected: string[];
    try {
        collected = collectWithVitest();
    } finally {
        rmSync(fixture.directory, { recursive: true, force: true });
    }

    const collectedSet = new Set(collected);
    const expected = enumerateExpectedSpecs();
    const expectedSet = new Set(expected);

    // 1. Absence, with the subject planted.
    const collectedWorktreeSpecs = collected.filter((path) => path.startsWith(`${worktreeRoot}/`));
    if (collectedWorktreeSpecs.length === 0) {
        console.log(`  ✓ no spec under ${worktreeRoot}/ was collected (fixture planted at ${fixture.specPath})`);
    } else {
        failures.push(
            [
                `  ✗ the root run collected ${collectedWorktreeSpecs.length} spec(s) under ${worktreeRoot}/.`,
                '    The exclusion in vite.config.ts is not matching agent worktrees.',
                formatSample(collectedWorktreeSpecs),
            ].join('\n')
        );
    }

    // 2. Presence, from an independent source.
    const missing = expected.filter((path) => !collectedSet.has(path));
    const unexpected = collected.filter((path) => !expectedSet.has(path));

    if (missing.length === 0) {
        console.log(`  ✓ all ${expected.length} spec files under ${collectableRoots.join(', ')} were collected`);
    } else {
        failures.push(
            [
                `  ✗ ${missing.length} spec file(s) exist on disk but were not collected.`,
                '    An exclusion, a --dir, or an include allowlist is dropping specs that should run.',
                formatSample(missing),
            ].join('\n')
        );
    }

    if (unexpected.length === 0) {
        console.log('  ✓ nothing outside the collectable roots was collected');
    } else {
        failures.push(
            [
                `  ✗ ${unexpected.length} collected spec file(s) live outside ${collectableRoots.join(', ')}.`,
                '    Either exclude them in vite.config.ts, or add their root to collectableRoots here.',
                formatSample(unexpected),
            ].join('\n')
        );
    }

    if (failures.length > 0) {
        console.error('\nvitest collection scope: DRIFT\n');
        console.error(failures.join('\n\n'));
        console.error('');
        return 1;
    }

    console.log(`\nvitest collection scope: OK (${collected.length} spec files)`);
    return 0;
}

process.exit(main());
