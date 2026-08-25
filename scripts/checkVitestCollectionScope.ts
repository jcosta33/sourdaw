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
 * How it can fail (ADR 0015). Independent verdicts, none of them vacuous:
 *
 *  1. **Absence, with the subject planted.** The check writes a real spec file into
 *     a throwaway directory under `.agents/worktrees/` before collecting, so the
 *     "no worktree paths were collected" assertion always has something it could
 *     have caught. A clean clone has no worktrees; without the fixture this
 *     assertion would pass by having nothing to look at, which is the blind shape
 *     ADR 0015 rule 4 names.
 *  2. **Server ownership parity.** One recursive walk finds every server spec while
 *     a separate direct-directory enumeration mirrors the exact glob in the server
 *     package's `node:test` command. Both populations must be non-empty and exactly
 *     equal, so a nested or differently placed spec cannot become ungated.
 *  3. **Owned absence, from an independent source.** Once parity establishes the
 *     dedicated server gate's complete population, root Vitest must collect none
 *     of it.
 *  4. **Presence, from an independent source.** The collected set is compared for
 *     exact equality against a filesystem walk of the collectable roots below. The
 *     two sides are sourced differently — vitest's glob resolution versus a plain
 *     directory walk — so neither can launder the other (rule 3). This side is what
 *     reds if an over-broad exclusion, or a `--dir` / `include` allowlist, silently
 *     drops specs that used to run: `scripts/__tests__/` holds four of them and
 *     lives outside `src`.
 *  5. **Registry, not list.** `collectableRoots` is the enumeration. A spec added
 *     anywhere inside a declared root is covered automatically; a new root is a
 *     deliberate edit here, and until it is made the equality fails loudly rather
 *     than the specs silently not running.
 *
 * Exit code 0 = collection scope is correct, 1 = drift (with a per-check report).
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Directories a root `vitest run` is meant to collect from. This is the population
 * the equality check enumerates; it is not a sample.
 *
 * `tests/e2e` is deliberately absent — those are Playwright specs, excluded by
 * `vite.config.ts` and run by `pnpm test:e2e <spec>`. `server` is also absent:
 * those specs use `node:test` and are owned by `pnpm health:server:full`.
 */
const collectableRoots = ['src', 'scripts', 'electron'] as const;

/** Specs owned by the dedicated server test gate, not root Vitest. */
const serverRoot = 'server';

/** Exact server runner contract from `server/package.json`. */
const serverTestCommand = 'tsx --test __tests__/*.spec.ts';
const serverTestDirectory = `${serverRoot}/__tests__`;

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

function enumerateSpecs(roots: readonly string[]): string[] {
    const found: string[] = [];
    for (const root of roots) {
        walkForSpecs(join(repoRoot, root), found);
    }
    return found.sort();
}

function enumerateServerRunnerSpecs(): { command: unknown; specs: string[] } {
    const packageMetadata = JSON.parse(readFileSync(join(repoRoot, serverRoot, 'package.json'), 'utf8')) as {
        scripts?: { test?: unknown };
    };
    const command = packageMetadata.scripts?.test;
    if (command !== serverTestCommand) {
        return { command, specs: [] };
    }

    let entries;
    try {
        entries = readdirSync(join(repoRoot, serverTestDirectory), { withFileTypes: true });
    } catch {
        return { command, specs: [] };
    }
    const specs = entries
        .filter((entry) => entry.isFile() && !entry.name.startsWith('.') && entry.name.endsWith('.spec.ts'))
        .map((entry) => `${serverTestDirectory}/${entry.name}`)
        .sort();
    return { command, specs };
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
    const expected = enumerateSpecs(collectableRoots);
    const expectedSet = new Set(expected);
    const serverSpecs = enumerateSpecs([serverRoot]);
    const serverRunner = enumerateServerRunnerSpecs();

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

    // 2. Exact ownership parity between every server spec and the actual npm test glob.
    const serverSpecSet = new Set(serverSpecs);
    const serverRunnerSpecSet = new Set(serverRunner.specs);
    const serverSpecsOutsideRunner = serverSpecs.filter((path) => !serverRunnerSpecSet.has(path));
    const runnerSpecsOutsideServer = serverRunner.specs.filter((path) => !serverSpecSet.has(path));
    if (serverRunner.command !== serverTestCommand) {
        failures.push(
            `  ✗ server/package.json test command must remain ${JSON.stringify(serverTestCommand)}; received ${JSON.stringify(serverRunner.command)}.`
        );
    }
    if (serverSpecs.length === 0) {
        failures.push(`  ✗ no spec files exist under ${serverRoot}/; server ownership parity would be vacuous.`);
    }
    if (serverRunner.specs.length === 0) {
        failures.push(
            `  ✗ ${serverTestDirectory}/*.spec.ts matched no direct files; the dedicated server gate would be vacuous.`
        );
    }
    if (serverSpecsOutsideRunner.length > 0 || runnerSpecsOutsideServer.length > 0) {
        const details = ['  ✗ recursively enumerated server specs do not exactly match the dedicated npm test glob.'];
        if (serverSpecsOutsideRunner.length > 0) {
            details.push('    Server specs not matched by the npm test glob:', formatSample(serverSpecsOutsideRunner));
        }
        if (runnerSpecsOutsideServer.length > 0) {
            details.push(
                '    npm test glob entries missing from the recursive server population:',
                formatSample(runnerSpecsOutsideServer)
            );
        }
        failures.push(details.join('\n'));
    } else if (serverSpecs.length > 0 && serverRunner.specs.length > 0) {
        console.log(`  ✓ all ${serverSpecs.length} server specs are owned by the exact npm test glob`);
    }

    // 3. Owned absence, from an independently enumerated, non-empty population.
    const collectedServerSpecs = serverSpecs.filter((path) => collectedSet.has(path));
    if (serverSpecs.length > 0 && collectedServerSpecs.length === 0) {
        console.log(`  ✓ none of the ${serverSpecs.length} spec files under ${serverRoot}/ were collected`);
    } else if (collectedServerSpecs.length > 0) {
        failures.push(
            [
                `  ✗ the root run collected ${collectedServerSpecs.length} spec(s) owned by ${serverRoot}/.`,
                '    These node:test specs belong to pnpm health:server:full.',
                formatSample(collectedServerSpecs),
            ].join('\n')
        );
    }

    // 4. Presence, from an independent source.
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
