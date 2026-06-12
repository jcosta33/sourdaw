#!/usr/bin/env node

import { spawnSync } from 'child_process';
import { getRepoRoot } from './git.ts';
import { parseArgs } from './cli.ts';
import { red, cyan, bold, green } from './colors.ts';

function run() {
    let repoRoot;
    try {
        repoRoot = getRepoRoot();
    } catch (e) {
        console.error(red('Error: Not inside a git repository.'));
        process.exit(1);
    }

    const { positional } = parseArgs(process.argv.slice(2));
    const targetFile = positional[0];

    if (!targetFile) {
        console.log(red('Usage: agents:format <path/to/file.ts>'));
        process.exit(1);
    }

    console.log(cyan(`\nFormatting ${bold(targetFile)}...`));

    const res = spawnSync('npx', ['prettier', '--write', targetFile], { cwd: repoRoot, stdio: 'inherit' });

    if (res.status === 0) {
        console.log(green(`✓ File formatted successfully.\n`));
    } else {
        console.log(red(`✗ Formatting failed.\n`));
        process.exit(1);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    run();
}
