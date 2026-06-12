#!/usr/bin/env node

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getRepoRoot } from './git.ts';
import { parseArgs } from './cli.ts';
import { red, cyan, bold, dim } from './colors.ts';

function skeletonize(content) {
    const lines = content.split('\n');
    const skeleton = [];
    let inDocBlock = false;

    for (const line of lines) {
        const trimmed = line.trim();

        // Keep JSDoc
        if (trimmed.startsWith('/**')) inDocBlock = true;
        if (inDocBlock) {
            skeleton.push(line);
            if (trimmed.endsWith('*/')) inDocBlock = false;
            continue;
        }

        // Keep top level signatures (imports, exports, types, interfaces, classes, function decls)
        // We do this naively by checking if the line starts with these keywords (ignoring exact brace matching for this Phase 1 tool).
        if (
            line.startsWith('import ') ||
            line.startsWith('export ') ||
            line.startsWith('interface ') ||
            line.startsWith('type ') ||
            line.startsWith('class ') ||
            line.startsWith('function ') ||
            line.startsWith('const ') ||
            line.startsWith('let ')
        ) {
            // If it's a one-liner or starts a block, keep it. If it ends with {, add it and we'll ignore the inner.
            skeleton.push(line);
            continue;
        }

        // Keep closing braces at the root level to maintain structural readability
        if (line === '}' || line === '};') {
            skeleton.push(line);
        }
    }

    return skeleton.join('\n');
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
        console.log(red('Usage: agents:compress <path/to/file.ts>'));
        process.exit(1);
    }

    const fullPath = join(repoRoot, targetFile);
    if (!existsSync(fullPath)) {
        console.error(red(`File not found: ${targetFile}`));
        process.exit(1);
    }

    const content = readFileSync(fullPath, 'utf8');
    const originalLines = content.split('\n').length;

    const compressed = skeletonize(content);
    const compressedLines = compressed.split('\n').length;

    console.log(cyan(`\nCompressed ${bold(targetFile)} (from ${originalLines} to ${compressedLines} lines):\n`));
    console.log(dim('--- SKELETON START ---'));
    console.log(compressed);
    console.log(dim('--- SKELETON END ---\n'));
}

if (import.meta.url === `file://${process.argv[1]}`) {
    run();
}
