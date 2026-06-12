#!/usr/bin/env node

import { spawnSync } from 'child_process';
import { getRepoRoot } from './git.ts';
import { parseArgs } from './cli.ts';
import { red, cyan, bold, dim } from './colors.ts';

function run() {
    let repoRoot;
    try {
        repoRoot = getRepoRoot();
    } catch (e) {
        console.error(red('Error: Not inside a git repository.'));
        process.exit(1);
    }

    const { positional, flags } = parseArgs(process.argv.slice(2));
    const symbol = positional[0];
    const pathFilter = flags.get('path') || 'src'; // defaults to src

    if (!symbol) {
        console.log(red('Usage: agents:references <symbol> [--path <dir>]'));
        process.exit(1);
    }

    console.log(cyan(`\nScanning for references to ${bold(symbol)} in ${bold(pathFilter)}...\n`));

    // Use git grep for lightning fast indexed search
    const res = spawnSync('git', ['grep', '-n', symbol, '--', pathFilter], { cwd: repoRoot, encoding: 'utf8' });

    if (res.status !== 0 || !res.stdout) {
        console.log(dim(`  No references found for "${symbol}".`));
        process.exit(0);
    }

    const lines = res.stdout.split('\n').filter(Boolean);
    const MAX_RESULTS = 30;

    let displayed = 0;
    for (const line of lines) {
        if (displayed >= MAX_RESULTS) {
            console.log(dim(`\n  ... and ${lines.length - MAX_RESULTS} more matches. Run manually to see all.`));
            break;
        }

        // Output format is usually: filePath:lineNumber:content
        const parts = line.split(':');
        if (parts.length >= 3) {
            const file = parts.shift();
            const lineNum = parts.shift();
            const text = parts.join(':').trim();
            console.log(`${bold(file)}:${cyan(lineNum)} ${dim(text)}`);
            displayed++;
        }
    }
    console.log('');
}

if (import.meta.url === `file://${process.argv[1]}`) {
    run();
}
