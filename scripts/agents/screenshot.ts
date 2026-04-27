#!/usr/bin/env node

import { spawnSync } from 'child_process';
import { join } from 'path';
import { getRepoRoot } from './git.ts';
import { parseArgs } from './cli.ts';
import { red, green, cyan, bold } from './colors.ts';
import { existsSync, mkdirSync } from 'fs';

function run() {
    let repoRoot;
    try {
        repoRoot = getRepoRoot();
    } catch (e) {
        console.error(red('Error: Not inside a git repository.'));
        process.exit(1);
    }

    const { positional } = parseArgs(process.argv.slice(2));
    const url = positional[0] || 'http://localhost:3000';

    const screenshotsDir = join(repoRoot, '.agents', 'screenshots');
    if (!existsSync(screenshotsDir)) {
        mkdirSync(screenshotsDir, { recursive: true });
    }

    const fileName = `capture-${Date.now()}.png`;
    const outputPath = join(screenshotsDir, fileName);

    console.log(cyan(`\nCapturing screenshot of ${bold(url)}...`));
    console.log(dim(`Using Playwright via npx (this may take a moment on first run)...`));

    // Run playwright screenshot tool natively via npx so we don't have to pollute package.json dependencies
    const res = spawnSync('npx', ['playwright', 'screenshot', url, outputPath], { stdio: 'inherit' });

    if (res.status === 0) {
        console.log(green(`\n✓ Screenshot saved to: ${outputPath}`));
        console.log(`(You can now pass this path to the LLM for visual validation against the UI spec)`);
    } else {
        console.log(red(`\n✗ Screenshot capture failed.`));
    }
}

function dim(str) {
    return `\x1b[2m${str}\x1b[0m`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    run();
}
