#!/usr/bin/env node

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getRepoRoot } from './git.ts';
import { parseArgs } from './cli.ts';
import { red, cyan, bold, dim, yellow } from './colors.ts';

function extractImports(content) {
    const lines = content.split('\n');
    const dependencies = [];

    for (const line of lines) {
        // Match `import ... from '...'` or `import '...'`
        const match = line.match(/import\s+.*?from\s+['"](.*?)['"]/);
        const matchBare = line.match(/import\s+['"](.*?)['"]/);

        if (match) {
            dependencies.push(match[1]);
        } else if (matchBare) {
            dependencies.push(matchBare[1]);
        }
    }
    return [...new Set(dependencies)]; // unique
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
        console.log(red('Usage: agents:graph <path/to/file.ts>'));
        process.exit(1);
    }

    const fullPath = join(repoRoot, targetFile);
    if (!existsSync(fullPath)) {
        console.error(red(`File not found: ${targetFile}`));
        process.exit(1);
    }

    const content = readFileSync(fullPath, 'utf8');
    const deps = extractImports(content);

    console.log(cyan(`\nDependency Graph for ${bold(targetFile)}:\n`));

    if (deps.length === 0) {
        console.log(dim('  (No internal/external dependencies found)'));
    } else {
        deps.forEach((dep) => {
            // Highlight external packages vs relative imports
            if (dep.startsWith('.') || dep.startsWith('src/')) {
                console.log(`  ├─ ${bold(dep)}`);
            } else {
                console.log(`  ├─ ${yellow(dep)} ${dim('(external)')}`);
            }
        });
    }
    console.log('');
}

if (import.meta.url === `file://${process.argv[1]}`) {
    run();
}
