#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
export function eslintEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const current = source.NODE_OPTIONS ?? '';
    if (HEAP_FLAG.test(current)) {
        return source;
    }
    return { ...source, NODE_OPTIONS: `${current} --max-old-space-size=${ESLINT_HEAP_MIB}`.trim() };
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

function runStep(label: string, args: string[], env: NodeJS.ProcessEnv = process.env): void {
    const result = spawnSync('pnpm', args, { stdio: 'inherit', env });
    if (result.error !== undefined) {
        throw new Error(`${label} failed to start: ${result.error.message}`);
    }
    if (result.status !== 0) {
        throw new Error(`${label} failed`);
    }
}

function main(): number {
    try {
        const options = parseArgs(process.argv.slice(2));
        const targets = options.full ? ['src', 'scripts'] : options.files;
        const eslintTargets = options.full ? ['src/**/*.{ts,tsx}', 'scripts/**/*.ts'] : options.files;
        runStep('oxlint', [
            'exec',
            'oxlint',
            '--quiet',
            `--threads=${lintThreads()}`,
            '--format=agent',
            ...(options.fix ? ['--fix'] : []),
            ...targets,
        ]);
        runStep(
            'eslint',
            [
                'exec',
                'eslint',
                '--quiet',
                `--concurrency=${lintConcurrency()}`,
                '--cache',
                '--cache-location',
                'node_modules/.cache/eslint/',
                ...(options.fix ? ['--fix'] : []),
                ...eslintTargets,
            ],
            eslintEnvironment(process.env)
        );
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
