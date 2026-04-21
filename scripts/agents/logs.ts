#!/usr/bin/env node

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getRepoRoot } from './git.ts';
import { parseArgs } from './cli.ts';
import { red, cyan, bold, dim, yellow } from './colors.ts';

function run() {
    let repoRoot;
    try {
        repoRoot = getRepoRoot();
    } catch (e) {
        console.error(red('Error: Not inside a git repository.'));
        process.exit(1);
    }

    const { positional, flags } = parseArgs(process.argv.slice(2));
    const slug = positional[0];
    
    if (!slug) {
        console.log(red('Usage: agents:logs <slug>'));
        process.exit(1);
    }

    const logFile = join(repoRoot, '.agents', 'logs', `${slug}.log`);
    
    if (!existsSync(logFile)) {
        console.error(yellow(`No log file found for agent "${slug}" at ${logFile}`));
        console.log(dim(`Logs are only generated if the agent was launched after Swarm V3 update, and not using the 'current' backend.`));
        process.exit(1);
    }

    console.log(cyan(`\nDisplaying logs for ${bold(slug)}:`));
    console.log(dim('--- LOG START ---'));
    
    const content = readFileSync(logFile, 'utf8');
    
    // If it's too huge, maybe tail it. Let's just output the whole thing for now,
    // since the human or LLM can use standard truncation or pagers.
    // We will truncate to last 500 lines to be safe.
    const lines = content.split('\n');
    const MAX_LINES = 500;
    
    if (lines.length > MAX_LINES) {
        console.log(yellow(`... (truncated ${lines.length - MAX_LINES} lines) ...`));
        console.log(lines.slice(-MAX_LINES).join('\n'));
    } else {
        console.log(content);
    }
    
    console.log(dim('--- LOG END ---\n'));
}

if (import.meta.url === `file://${process.argv[1]}`) {
    run();
}
