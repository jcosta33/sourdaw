#!/usr/bin/env node

import { readFileSync, statSync, readdirSync } from 'fs';
import { join } from 'path';
import { getRepoRoot } from './git.ts';
import { parseArgs } from './cli.ts';
import { red, cyan, bold, dim, yellow, green } from './colors.ts';

function findFiles(dir) {
    let results = [];
    try {
        const entries = readdirSync(dir);
        for (const entry of entries) {
            if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
            const fullPath = join(dir, entry);
            if (statSync(fullPath).isDirectory()) {
                results = results.concat(findFiles(fullPath));
            } else if (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx')) {
                results.push(fullPath);
            }
        }
    } catch (e) {
        // Ignore read errors
    }
    return results;
}

function run() {
    let repoRoot;
    try {
        repoRoot = getRepoRoot();
    } catch (e) {
        console.error(red('Error: Not inside a git repository.'));
        process.exit(1);
    }

    console.log(cyan(`\nEnforcing Architectural Boundaries (AGENTS.md)...\n`));

    const srcDir = join(repoRoot, 'src');
    const files = findFiles(srcDir);

    let violations = 0;

    for (const file of files) {
        const content = readFileSync(file, 'utf8');
        const lines = content.split('\n');

        // Regex to catch cross-module deep imports.
        // Matches: import ... from '...src/modules/ModuleName/useCases/...'
        // It allows imports from 'src/modules/ModuleName' or 'src/modules/ModuleName/index.ts'
        const regex =
            /import\s+.*?from\s+['"](.*src\/modules\/([^\/]+)\/(useCases|stores|presentations|models|repositories|engine|handlers)\/.*)['"]/g;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            let match;

            // Need a fresh regex per line since we have 'g' flag, or just use matchAll
            const lineMatches = [...line.matchAll(regex)];

            for (const m of lineMatches) {
                const importPath = m[1];
                const targetModule = m[2];
                const folder = m[3];

                // Allow internal imports within the same module
                if (file.includes(`src/modules/${targetModule}/`)) {
                    continue; // Local to the module, allowed
                }

                violations++;
                console.log(red(`✗ Architectural Violation in `) + bold(file.replace(repoRoot + '/', '')));
                console.log(`  Line ${i + 1}: Cross-module import into private internal ${yellow(`'${folder}/'`)}`);
                console.log(dim(`  > ${line.trim()}`));
                console.log(dim(`  Fix: Target the module's root index.ts instead.\n`));
            }
        }
    }

    if (violations === 0) {
        console.log(green(`✓ Zero cross-module boundary violations found.`));
    } else {
        console.log(red(`\nFound ${violations} architectural boundary violations. Agent must fix these before PR.`));
        process.exit(1);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    run();
}
