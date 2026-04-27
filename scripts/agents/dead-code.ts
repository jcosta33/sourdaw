#!/usr/bin/env node

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { getRepoRoot } from './git.ts';
import { parseArgs } from './cli.ts';
import { red, cyan, bold, dim, yellow, green } from './colors.ts';

function extractExports(content) {
    const exports = [];
    const regex = /export\s+(const|let|var|function|class|type|interface)\s+([a-zA-Z0-9_]+)/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
        exports.push(match[2]);
    }
    return exports;
}

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
        console.log(red('Usage: agents:dead-code <path/to/file.ts>'));
        process.exit(1);
    }

    const fullPath = join(repoRoot, targetFile);
    if (!existsSync(fullPath)) {
        console.error(red(`File not found: ${targetFile}`));
        process.exit(1);
    }

    const content = readFileSync(fullPath, 'utf8');
    const exports = extractExports(content);

    console.log(cyan(`\nDead Code Analysis for ${bold(targetFile)}:`));

    if (exports.length === 0) {
        console.log(dim('  (No top-level exported symbols found)'));
        process.exit(0);
    }

    const dead = [];

    for (const symbol of exports) {
        // Fast global search for the symbol
        const res = spawnSync('git', ['grep', '-l', '\\b' + symbol + '\\b'], { cwd: repoRoot, encoding: 'utf8' });

        if (res.status === 0 && res.stdout) {
            const files = res.stdout.split('\n').filter(Boolean);
            // Check if it is used in files OTHER than itself and specs
            const usedElsewhere = files.some(
                (f) => f !== targetFile && !f.endsWith('.spec.ts') && !f.endsWith('.spec.tsx')
            );

            if (!usedElsewhere) {
                dead.push(symbol);
            }
        } else {
            dead.push(symbol); // not even found? Must be dead.
        }
    }

    if (dead.length === 0) {
        console.log(green(`✓ All exported symbols are imported elsewhere in the project.`));
    } else {
        console.log(yellow(`⚠ Found ${dead.length} potentially unused exports:`));
        dead.forEach((sym) => console.log(`  - ${bold(sym)}`));
        console.log(
            dim(`  (Note: these are only unused outside this file. They may be used internally or dynamically.)`)
        );
    }
    console.log('');
}

if (import.meta.url === `file://${process.argv[1]}`) {
    run();
}
