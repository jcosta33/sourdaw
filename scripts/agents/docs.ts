#!/usr/bin/env node

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getRepoRoot } from './git.ts';
import { parseArgs } from './cli.ts';
import { red, cyan, bold, dim, green } from './colors.ts';

function extractDocs(content) {
    const lines = content.split('\n');
    const docs = [];
    let inDocBlock = false;
    let currentBlock = [];

    for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed.startsWith('/**')) {
            inDocBlock = true;
            currentBlock = [];
        }

        if (inDocBlock) {
            currentBlock.push(line);
            if (trimmed.endsWith('*/')) {
                inDocBlock = false;
                docs.push(currentBlock.join('\n'));
            }
        }
    }

    return docs;
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
        console.log(red('Usage: agents:docs <path/to/file.ts>'));
        process.exit(1);
    }

    const fullPath = join(repoRoot, targetFile);
    if (!existsSync(fullPath)) {
        console.error(red(`File not found: ${targetFile}`));
        process.exit(1);
    }

    const content = readFileSync(fullPath, 'utf8');
    const docs = extractDocs(content);

    console.log(cyan(`\nExtracted Documentation for ${bold(targetFile)}:\n`));

    if (docs.length === 0) {
        console.log(dim('  (No JSDoc blocks found in this file)'));
    } else {
        docs.forEach((block) => {
            console.log(green(block) + '\n');
        });
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    run();
}
