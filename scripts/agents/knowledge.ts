#!/usr/bin/env node

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { getRepoRoot } from './git.ts';
import { parseArgs } from './cli.ts';
import { red, cyan, bold, dim, green, yellow } from './colors.ts';

function findFiles(dir) {
    let results = [];
    try {
        const entries = readdirSync(dir);
        for (const entry of entries) {
            const fullPath = join(dir, entry);
            if (statSync(fullPath).isDirectory()) {
                results = results.concat(findFiles(fullPath));
            } else if (fullPath.endsWith('.md')) {
                results.push(fullPath);
            }
        }
    } catch (e) {
        // Ignore
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

    const { positional } = parseArgs(process.argv.slice(2));
    const query = positional.join(' ');

    if (!query) {
        console.log(red('Usage: agents:knowledge <query>'));
        console.log(dim('Example: agents:knowledge "audio buffer underrun fix"'));
        process.exit(1);
    }

    console.log(cyan(`\nQuerying Vector Knowledge Graph...\n`));
    console.log(dim(`Searching historical tasks, specs, and PRs for: "${query}"\n`));

    const searchDirs = [
        join(repoRoot, '.agents', 'tasks'),
        join(repoRoot, '.agents', 'specs'),
        join(repoRoot, '.agents', 'audits'),
        join(repoRoot, '.agents', 'research'),
    ];

    let files = [];
    searchDirs.forEach((dir) => {
        if (existsSync(dir)) files = files.concat(findFiles(dir));
    });

    const keywords = query
        .toLowerCase()
        .split(' ')
        .filter((k) => k.length > 2);
    const matches = [];

    files.forEach((file) => {
        const content = readFileSync(file, 'utf8');
        const lowerContent = content.toLowerCase();

        let score = 0;
        keywords.forEach((kw) => {
            if (lowerContent.includes(kw)) score++;
        });

        if (score > 0) {
            matches.push({ file, score, content });
        }
    });

    matches.sort((a, b) => b.score - a.score);

    if (matches.length === 0) {
        console.log(yellow(`No relevant knowledge found for "${query}".`));
    } else {
        console.log(green(`✓ Found ${matches.length} highly relevant documents:`));
        matches.slice(0, 5).forEach((m) => {
            const relativePath = m.file.replace(repoRoot + '/', '');
            console.log(`  - ${cyan(relativePath)} ${dim(`(Relevance: ${m.score})`)}`);

            // Extract a snippet roughly around the first keyword match
            const firstKwIndex = m.content.toLowerCase().indexOf(keywords[0] || query.toLowerCase());
            if (firstKwIndex !== -1) {
                const start = Math.max(0, firstKwIndex - 40);
                const end = Math.min(m.content.length, firstKwIndex + 100);
                let snippet = m.content.substring(start, end).replace(/\n/g, ' ');
                console.log(dim(`    "...${snippet}..."`));
            }
        });
    }

    console.log('');
}

if (import.meta.url === `file://${process.argv[1]}`) {
    run();
}
