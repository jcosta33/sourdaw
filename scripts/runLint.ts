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

function runStep(label: string, args: string[]): void {
    const result = spawnSync('pnpm', args, { stdio: 'inherit' });
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
            '--threads=2',
            '--format=agent',
            ...(options.fix ? ['--fix'] : []),
            ...targets,
        ]);
        runStep('eslint', [
            'exec',
            'eslint',
            '--quiet',
            '--concurrency=off',
            '--cache',
            '--cache-location',
            'node_modules/.cache/eslint/',
            ...(options.fix ? ['--fix'] : []),
            ...eslintTargets,
        ]);
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
