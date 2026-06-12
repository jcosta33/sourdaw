#!/usr/bin/env node

import { writeFileSync, existsSync, mkdirSync, readFileSync, appendFileSync } from 'fs';
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

    // Determine current agent slug from the path or environment
    // For simplicity in the script, we expect `--from <slug>` or we read it from worktree name
    const worktreeName = repoRoot.split('/').pop();
    let mySlug = worktreeName.startsWith('agents-') ? worktreeName.replace('agents-', '') : 'host';

    const { positional, flags } = parseArgs(process.argv.slice(2));
    const targetSlug = positional[0];
    const message = flags.get('message') || flags.get('m');

    if (flags.get('from')) {
        mySlug = flags.get('from');
    }

    if (!targetSlug) {
        console.log(red('Usage: agents:chat <target-slug> [--message "your message"]'));
        process.exit(1);
    }

    const ipcDir = join(getRepoRoot(), '.agents', 'ipc'); // put it in the host repo
    if (!existsSync(ipcDir)) mkdirSync(ipcDir, { recursive: true });

    // Consistent filename regardless of who started it
    const participants = [mySlug, targetSlug].sort();
    const chatFile = join(ipcDir, `${participants[0]}-${participants[1]}.md`);

    if (message) {
        // Send mode
        const timestamp = new Date().toISOString();
        const entry = `\n### [${timestamp}] **${mySlug}**:\n${message}\n`;
        appendFileSync(chatFile, entry, 'utf8');
        console.log(cyan(`Message sent to ${bold(targetSlug)}.`));
    } else {
        // Read mode
        if (!existsSync(chatFile)) {
            console.log(yellow(`No active IPC channel between ${mySlug} and ${targetSlug}.`));
            process.exit(0);
        }
        console.log(cyan(`\n--- IPC Log: ${bold(participants[0])} <-> ${bold(participants[1])} ---\n`));
        console.log(readFileSync(chatFile, 'utf8'));
        console.log(dim('--- End of Log ---\n'));
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    run();
}
