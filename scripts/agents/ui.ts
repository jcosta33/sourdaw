#!/usr/bin/env node

import { getRepoRoot } from './git.ts';
import { listAgentWorktrees } from './git.ts';
import { readState, isProcessRunning } from './state.ts';
import { cyan, bold, green, red, yellow, dim } from './colors.ts';

const clearScreen = () => process.stdout.write('\x1Bc');
const hideCursor = () => process.stdout.write('\x1B[?25l');
const showCursor = () => process.stdout.write('\x1B[?25h');
const moveCursorToTop = () => process.stdout.write('\x1B[H');

function renderDashboard(repoRoot) {
    const sandboxes = listAgentWorktrees(repoRoot);
    const globalState = readState(repoRoot);

    moveCursorToTop();
    console.log(`\n  ${bold(cyan('👾 Swarm Command Center'))}  ${dim(`(Updated: ${new Date().toLocaleTimeString()})`)}`);
    console.log(`  ${'─'.repeat(60)}`);

    if (sandboxes.length === 0) {
        console.log(`  ${dim('No active agents in the swarm.')}`);
    }

    sandboxes.forEach(s => {
        const state = globalState[s.slug] || {};
        let statusTag = dim('[IDLE]');
        
        if (state.status === 'running') {
            if (state.pid) {
                const alive = isProcessRunning(state.pid);
                statusTag = alive ? green('[RUNNING]') : red('[CRASHED]');
            } else {
                statusTag = green('[LAUNCHED]');
            }
        } else if (state.status) {
            statusTag = yellow(`[${state.status.toUpperCase()}]`);
        }

        const backend = state.backend ? dim(` via ${state.backend}`) : '';
        const pid = state.pid ? dim(` (PID: ${state.pid})`) : '';
        
        console.log(`  ${statusTag.padEnd(20)} ${bold(s.slug)} ${pid}${backend}`);
        console.log(`  ${dim('↳')} Branch: ${s.branch}`);
    });

    console.log(`\n  ${'─'.repeat(60)}`);
    console.log(`  ${dim('Press Ctrl+C to exit.')}`);
}

function run() {
    let repoRoot;
    try {
        repoRoot = getRepoRoot();
    } catch (e) {
        console.error(red('Error: Not inside a git repository.'));
        process.exit(1);
    }

    hideCursor();
    clearScreen();

    // Initial render
    renderDashboard(repoRoot);

    // Refresh every 2 seconds
    const interval = setInterval(() => {
        renderDashboard(repoRoot);
    }, 2000);

    // Cleanup on exit
    process.on('SIGINT', () => {
        clearInterval(interval);
        showCursor();
        console.log('');
        process.exit(0);
    });
}

if (import.meta.url === `file://${process.argv[1]}`) {
    run();
}
