#!/usr/bin/env node

import { spawnSync } from 'child_process';
import { getRepoRoot } from './git.ts';
import { red, green, yellow, bold, cyan } from './colors.ts';

const MAX_LINES_PER_TEST_OUTPUT = 50;

function runAndTruncate(commandStr, args, cwd) {
    console.log(`\n${bold(cyan('>'))} ${commandStr} ${args.join(' ')}`);

    const result = spawnSync(commandStr, args, {
        cwd,
        encoding: 'utf8',
        shell: process.platform === 'win32',
    });

    const success = result.status === 0;
    const rawOutput = (result.stdout || '') + (result.stderr || '');
    let outputLines = rawOutput.split('\n');

    if (outputLines.length > MAX_LINES_PER_TEST_OUTPUT) {
        const truncatedCount = outputLines.length - MAX_LINES_PER_TEST_OUTPUT;
        // Keep the top 20 lines (usually the error summary) and bottom 30 lines (usually the stack trace / summary)
        const top = outputLines.slice(0, 20);
        const bottom = outputLines.slice(outputLines.length - 30);

        outputLines = [
            ...top,
            '',
            yellow(`... (truncated ${truncatedCount} lines of test output for LLM brevity)`),
            yellow(`Run '${commandStr} ${args.join(' ')}' manually to see the full trace.`),
            '',
            ...bottom,
        ];
    }

    const output = outputLines.join('\n').trim();
    if (output) {
        console.log(output);
    }

    if (success) {
        console.log(green(`\n✓ Tests Passed`));
    } else {
        console.log(red(`\n✗ Tests Failed (exit code: ${result.status})`));
        // Auto-Rollback concept: in a real swarm, the orchestrator detects this exit code 3 times and runs git reset.
        console.log(yellow(`Swarm Notice: If this fails 3 times, Auto-Rollback will be triggered by the Delegator.`));
    }

    return success;
}

function runTest(args) {
    let repoRoot;
    try {
        repoRoot = getRepoRoot();
    } catch (e) {
        console.error(red('Error: Not inside a git repository.'));
        process.exit(1);
    }

    let pnpmArgs = ['run', 'test', '--run']; // --run disables watch mode for vitest

    // Pass any extra args (like specific files) down to vitest
    if (args.length > 0) {
        pnpmArgs = pnpmArgs.concat(args);
    }

    const passed = runAndTruncate('pnpm', pnpmArgs, repoRoot);
    process.exit(passed ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    runTest(process.argv.slice(2));
}
