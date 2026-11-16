#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { matchesGlob, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

type Options = {
    files: string[];
    fix: boolean;
    full: boolean;
};

export function parseArgs(args: string[]): Options {
    const files: string[] = [];
    let fix = false;
    let full = false;
    for (const argument of args) {
        if (argument === '--') {
            continue;
        }
        if (argument === '--fix') {
            fix = true;
            continue;
        }
        if (argument === '--full') {
            full = true;
            continue;
        }
        if (argument.startsWith('-')) {
            throw new Error(`unknown option: ${argument}`);
        }
        files.push(argument);
    }
    if (full && files.length > 0) {
        throw new Error('--full does not accept file targets');
    }
    if (!full && files.length === 0) {
        throw new Error('file target required; use lint:full for the repository');
    }
    if (fix && full) {
        throw new Error('full-tree automatic lint fixes are forbidden');
    }
    return { files, fix, full };
}

const ESLINT_HEAP_MIB = 6_144;
const HEAP_FLAG = /--max[-_]old[-_]space[-_]size(?:=|\s+)(\d+)/;

/**
 * A cold `--cache` eslint run holds the whole type-aware program in one process
 * and needs more heap than Node's default gives it on a small machine, so the
 * run aborts with an OOM mark-compact failure instead of reporting lint results
 * — a crash a caller tells from a pass only by reading the output.
 *
 * An ancestor that already set `--max-old-space-size` is obeyed rather than
 * overridden. `pnpm guard` is such an ancestor, and V8 honours the last
 * occurrence of a repeated flag, so appending a larger one would silently
 * defeat exactly the ceiling the guard exists to impose. A run that needs more
 * heap than the guard allows has to say so through the guard, not around it —
 * today it cannot, which is #2678, and until that lands this command does not
 * complete under the guard from a cold cache.
 */
export function eslintEnvironment(source: NodeJS.ProcessEnv, fix = false): NodeJS.ProcessEnv {
    const current = source.NODE_OPTIONS ?? '';
    const environment = { ...source, SOURDAW_LINT_COFIX: fix ? '1' : '0' };
    if (HEAP_FLAG.test(current)) {
        return environment;
    }
    return { ...environment, NODE_OPTIONS: `${current} --max-old-space-size=${ESLINT_HEAP_MIB}`.trim() };
}

/**
 * Both linters run single-file-at-a-time by default here, and that default is
 * an agent-session ceiling rather than a property of the work: a lane shares
 * its machine with every other lane and with the resource guard's reservations.
 * CI has neither constraint, and the eslint leg is the longest single check in
 * the fast lane, so it is the one worth giving the cores.
 *
 * `SOURDAW_LINT_CONCURRENCY` takes `off`, `auto`, or a worker count.
 */
export function lintConcurrency(source: NodeJS.ProcessEnv = process.env): string {
    return source.SOURDAW_LINT_CONCURRENCY ?? 'off';
}

export function lintThreads(source: NodeJS.ProcessEnv = process.env): string {
    return source.SOURDAW_LINT_THREADS ?? '2';
}

/**
 * Existing violations of promoted rules, counted per file and rule. Naming the file explicitly
 * makes ESLint refuse to run when it is missing instead of silently reporting no suppressions,
 * and ESLint fails a run whose linted files hold fewer violations than recorded, so the file
 * only shrinks through `--prune-suppressions`.
 */
export const ESLINT_SUPPRESSIONS_FILE = 'eslint-suppressions.json';

export function buildEslintArgv(
    options: Pick<Options, 'fix' | 'full'>,
    eslintTargets: string[],
    env: NodeJS.ProcessEnv = process.env
): string[] {
    return [
        'exec',
        'eslint',
        // Fix mode loads the moved plugin overrides, whose size rules warn on the eslint.size-baseline.mjs
        // files under their own burn-down ratchet; check mode has no warn rules.
        ...(options.fix ? ['--quiet'] : []),
        `--concurrency=${lintConcurrency(env)}`,
        '--cache',
        '--cache-location',
        options.fix ? 'node_modules/.cache/eslint/cofix/' : 'node_modules/.cache/eslint/check/',
        '--cache-strategy',
        'content',
        '--suppressions-location',
        ESLINT_SUPPRESSIONS_FILE,
        ...(options.fix ? ['--fix'] : []),
        ...eslintTargets,
    ];
}

export function buildOxlintArgv(
    options: Pick<Options, 'fix'>,
    targets: string[],
    env: NodeJS.ProcessEnv = process.env
): string[] {
    return [
        'exec',
        'oxlint',
        // Focused JS tooling can be intentionally excluded from this pass
        // while remaining covered by the public plugins and ESLint.
        '--no-error-on-unmatched-pattern',
        `--threads=${lintThreads(env)}`,
        '--format=agent',
        ...(options.fix ? ['--fix'] : []),
        ...targets,
    ];
}

export function ensureServerDependencies(
    targets: string[],
    rootDir: string = process.cwd(),
    existsSyncFn: typeof existsSync = existsSync,
    spawnSyncFn: typeof spawnSync = spawnSync
): boolean {
    if (targets.some((target) => target === 'server' || target.startsWith('server/'))) {
        const serverNodeModules = resolve(rootDir, 'server/node_modules');
        if (!existsSyncFn(serverNodeModules)) {
            const result = spawnSyncFn('npm', ['--prefix', 'server', 'ci', '--include=dev'], {
                stdio: 'inherit',
                cwd: rootDir,
            });
            if (result.status !== 0) {
                throw new Error('failed to install server dependencies for linting');
            }
            return true;
        }
    }
    return false;
}

function runStep(label: string, args: string[], env: NodeJS.ProcessEnv = process.env): void {
    console.log(`lint: ${label} started`);
    const started = performance.now();
    const result = spawnSync('pnpm', args, { stdio: 'inherit', env });
    const outcome = result.error === undefined && result.status === 0 ? 'passed' : 'failed';
    console.log(`lint: ${label} ${outcome} (${Math.round(performance.now() - started)} ms)`);
    if (result.error !== undefined) {
        throw new Error(`${label} failed to start: ${result.error.message}`);
    }
    if (result.status !== 0) {
        throw new Error(`${label} failed`);
    }
}

export const FULL_OXLINT_TARGETS = ['src', 'scripts', 'electron', 'tests/e2e', 'server'] as const;
export const FULL_ESLINT_TARGETS = [
    'src/**/*.{ts,tsx}',
    'scripts/**/*.ts',
    'electron/**/*.ts',
    'tests/e2e/**/*.ts',
    'server/**/*.ts',
    'scripts/lint/sourdaw.mjs',
] as const;

/**
 * Oxlint expands directories itself but not shell globs, and this runner spawns
 * without a shell: a glob target matches nothing and the pass lints only the
 * literal plugin file while still reporting success. The full run therefore
 * hands the plugins pass directories, never the ESLint glob targets.
 */
export function publicPluginTargets(options: Pick<Options, 'files' | 'full'>): string[] {
    return options.full ? [...FULL_OXLINT_TARGETS] : options.files;
}

/**
 * The agent format omits the linted-file count, so a full run uses the default
 * format, whose summary line carries it.
 */
export function buildPublicPluginsArgv(
    targets: string[],
    env: NodeJS.ProcessEnv = process.env,
    format: 'agent' | 'default' = 'agent'
): string[] {
    return [
        'exec',
        'oxlint',
        '--config=.oxlint-plugins.json',
        // The only warn rules here are the size rules on the eslint.size-baseline.mjs
        // files, which have their own burn-down ratchet; without --quiet every run
        // would print the known baseline warnings.
        '--quiet',
        `--threads=${lintThreads(env)}`,
        `--format=${format}`,
        ...targets,
    ];
}

const OXLINT_SOURCE_EXTENSION = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/**
 * Oxlint prints "Finished in 1.2s on 12481 files with 102 rules using 12 threads."
 */
export function parseLintedFileCount(output: string): number | undefined {
    const match = /Finished in \S+ on (\d+) files?\b/.exec(output);
    return match?.[1] === undefined ? undefined : Number(match[1]);
}

const PUBLIC_PLUGINS_CONFIG = '.oxlint-plugins.json';

/**
 * Gitignore-style, as the linter reads them: `dir/` names a directory at any
 * depth, a pattern without a slash matches the basename at any depth, anything
 * else is a glob over the repository-relative path.
 */
export function isIgnoredByPattern(file: string, pattern: string): boolean {
    if (pattern.endsWith('/')) {
        const directory = pattern.slice(0, -1);
        return file.split('/').slice(0, -1).includes(directory);
    }
    if (!pattern.includes('/')) {
        return matchesGlob(file.slice(file.lastIndexOf('/') + 1), pattern);
    }
    return matchesGlob(file, pattern);
}

export function unignoredSourceFiles(files: readonly string[], ignorePatterns: readonly string[]): string[] {
    return files.filter(
        (file) =>
            OXLINT_SOURCE_EXTENSION.test(file) && !ignorePatterns.some((pattern) => isIgnoredByPattern(file, pattern))
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function readIgnorePatterns(rootDir: string): string[] {
    const parsed = ts.parseConfigFileTextToJson(
        PUBLIC_PLUGINS_CONFIG,
        readFileSync(resolve(rootDir, PUBLIC_PLUGINS_CONFIG), 'utf8')
    );
    const config: unknown = parsed.config;
    const patterns: unknown = isRecord(config) ? config.ignorePatterns : undefined;
    if (parsed.error !== undefined || !Array.isArray(patterns) || !patterns.every((p) => typeof p === 'string')) {
        throw new Error(`${PUBLIC_PLUGINS_CONFIG} has no readable ignorePatterns list`);
    }
    return patterns;
}

/**
 * Every tracked source file the pass must lint: the ones under its targets that
 * the config does not ignore. The linter may lint more (untracked files), never
 * fewer, so the count is compared exactly rather than against a tolerance that
 * would let a whole skipped target through.
 */
export function expectedPluginFiles(targets: string[], rootDir: string = process.cwd()): string[] {
    const result = spawnSync('git', ['ls-files', '-z', '--', ...targets], {
        cwd: rootDir,
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
    });
    if (result.error !== undefined || result.status !== 0) {
        throw new Error('git ls-files failed while listing the plugin pass targets');
    }
    return unignoredSourceFiles([...new Set(result.stdout.split('\0'))], readIgnorePatterns(rootDir));
}

export function assertPluginCoverage(
    linted: number | undefined,
    expectedFiles: readonly string[],
    targets: readonly string[]
): void {
    if (linted === undefined) {
        throw new Error('oxlint-plugins reported no linted file count, so its coverage cannot be verified');
    }
    if (linted < expectedFiles.length) {
        throw new Error(
            `oxlint-plugins linted ${linted} files but ${expectedFiles.length} tracked source files lie under its targets`
        );
    }
    for (const target of targets) {
        const contributes = expectedFiles.some((file) => file === target || file.startsWith(`${target}/`));
        if (!contributes) {
            throw new Error(`oxlint-plugins target ${target} contributes no tracked source file to the pass`);
        }
    }
}

function checkPublicPlugins(options: Pick<Options, 'files' | 'full'>): void {
    const targets = publicPluginTargets(options);
    if (!options.full) {
        runStep('oxlint-plugins', buildPublicPluginsArgv(targets));
        return;
    }
    console.log('lint: oxlint-plugins started');
    const started = performance.now();
    const result = spawnSync('pnpm', buildPublicPluginsArgv(targets, process.env, 'default'), {
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
    });
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    const elapsed = `${Math.round(performance.now() - started)} ms`;
    if (result.error !== undefined || result.status !== 0) {
        console.log(`lint: oxlint-plugins failed (${elapsed})`);
        throw new Error(
            result.error === undefined
                ? 'oxlint-plugins failed'
                : `oxlint-plugins failed to start: ${result.error.message}`
        );
    }
    assertPluginCoverage(parseLintedFileCount(result.stdout), expectedPluginFiles(targets), targets);
    console.log(`lint: oxlint-plugins passed (${elapsed})`);
}

function main(): number {
    try {
        const options = parseArgs(process.argv.slice(2));
        const targets = options.full ? [...FULL_OXLINT_TARGETS] : options.files;
        const eslintTargets = options.full ? [...FULL_ESLINT_TARGETS] : options.files;
        ensureServerDependencies(targets);
        runStep('oxlint', buildOxlintArgv(options, targets));
        if (!options.fix) {
            // Check mode uses Oxlint for public JS rules. Fix mode keeps them
            // with Prettier so relocated diagnostics and their fixes converge.
            checkPublicPlugins(options);
        }
        runStep('eslint', buildEslintArgv(options, eslintTargets), eslintEnvironment(process.env, options.fix));
        if (options.fix) {
            // Preserve Oxlint's parser and target-admission contracts on the
            // final bytes without introducing another writer or fix loop.
            checkPublicPlugins(options);
        }
        return 0;
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        return 1;
    }
}

const invokedPath = process.argv[1] === undefined ? '' : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
    process.exit(main());
}
