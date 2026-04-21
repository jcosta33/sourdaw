#!/usr/bin/env node

import { watch } from 'fs';
import { spawn } from 'child_process';
import { join } from 'path';
import { getRepoRoot } from './git.ts';
import { red, cyan, bold, dim, yellow } from './colors.ts';

function run() {
    let repoRoot;
    try {
        repoRoot = getRepoRoot();
    } catch (e) {
        console.error(red('Error: Not inside a git repository.'));
        process.exit(1);
    }

    console.log(cyan(`\nStarting Swarm Daemon (Background Watcher)...\n`));
    console.log(dim(`Watching src/ for changes to trigger automated test-radius...`));

    let timeout = null;
    let activeProcess = null;

    watch(join(repoRoot, 'src'), { recursive: true }, (eventType, filename) => {
        if (!filename || !filename.endsWith('.ts') && !filename.endsWith('.tsx')) return;
        if (filename.endsWith('.spec.ts') || filename.endsWith('.spec.tsx')) return;

        if (timeout) clearTimeout(timeout);
        
        // Debounce saves
        timeout = setTimeout(() => {
            console.log(yellow(`\n[Daemon] Detected change in ${filename}`));
            
            if (activeProcess) {
                console.log(dim(`Killing previous test run...`));
                activeProcess.kill();
            }

            console.log(cyan(`Running blast radius check...`));
            activeProcess = spawn('pnpm', ['agents:test-radius', join('src', filename)], { 
                cwd: repoRoot,
                stdio: 'inherit'
            });

            activeProcess.on('close', (code) => {
                if (code === 0) {
                    console.log(dim(`[Daemon] Radius check passed.`));
                } else if (code !== null) {
                    console.log(red(`[Daemon] Radius check FAILED.`));
                }
                activeProcess = null;
            });

        }, 1000);
    });
}

if (import.meta.url === `file://${process.argv[1]}`) {
    run();
}
