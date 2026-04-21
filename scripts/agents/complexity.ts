#!/usr/bin/env node

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getRepoRoot } from './git.ts';
import { parseArgs } from './cli.ts';
import { red, cyan, bold, dim, yellow, green } from './colors.ts';

function calculateComplexity(content) {
    // Naive cyclomatic complexity heuristic
    let score = 1; // base score for the file
    
    const keywords = [
        /\bif\s*\(/g,
        /\belse\s+if\b/g,
        /\bfor\s*\(/g,
        /\bwhile\s*\(/g,
        /\bcase\b/g,
        /\bcatch\s*\(/g,
        /&&/g,
        /\|\|/g,
        /\?/g // ternary operator
    ];

    for (const regex of keywords) {
        const matches = content.match(regex);
        if (matches) {
            score += matches.length;
        }
    }

    return score;
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
        console.log(red('Usage: agents:complexity <path/to/file.ts>'));
        process.exit(1);
    }

    const fullPath = join(repoRoot, targetFile);
    if (!existsSync(fullPath)) {
        console.error(red(`File not found: ${targetFile}`));
        process.exit(1);
    }

    const content = readFileSync(fullPath, 'utf8');
    const score = calculateComplexity(content);

    console.log(cyan(`\nComplexity Analysis for ${bold(targetFile)}:`));
    console.log(dim('Heuristic cyclomatic score (lower is better):'));
    
    if (score < 10) {
        console.log(green(`Score: ${score} - Excellent. Highly maintainable.`));
    } else if (score < 25) {
        console.log(yellow(`Score: ${score} - Moderate. Keep an eye on nested logic.`));
    } else {
        console.log(red(`Score: ${score} - High Complexity! Consider refactoring and splitting logic.`));
    }
    console.log('');
}

if (import.meta.url === `file://${process.argv[1]}`) {
    run();
}
