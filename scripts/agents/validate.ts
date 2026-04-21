#!/usr/bin/env node

import { spawnSync } from 'child_process';
import { getRepoRoot } from './git.ts';
import { loadConfig } from './config.ts';
import { red, green, yellow, bold, cyan } from './colors.ts';

const MAX_LINES_PER_COMMAND = 50;

function runAndTruncate(commandStr, cwd) {
    if (!commandStr) return null;
    
    console.log(`\n${bold(cyan('>'))} ${commandStr}`);
    
    const [cmd, ...args] = commandStr.split(' ');
    const result = spawnSync(cmd, args, {
        cwd,
        encoding: 'utf8',
        shell: process.platform === 'win32', // Use shell on Windows to resolve commands like 'pnpm' correctly
    });

    const success = result.status === 0;
    const rawOutput = (result.stdout || '') + (result.stderr || '');
    let outputLines = rawOutput.split('\n');

    if (outputLines.length > MAX_LINES_PER_COMMAND) {
        const truncatedCount = outputLines.length - MAX_LINES_PER_COMMAND;
        outputLines = outputLines.slice(0, MAX_LINES_PER_COMMAND);
        outputLines.push('');
        outputLines.push(yellow(`... (truncated ${truncatedCount} lines of output for brevity)`));
        outputLines.push(yellow(`Run '${commandStr}' manually in your terminal if you need the full output.`));
    }

    const output = outputLines.join('\n').trim();
    if (output) {
        console.log(output);
    }
    
    if (success) {
        console.log(green(`✓ Success`));
    } else {
        console.log(red(`✗ Failed (exit code: ${result.status})`));
    }

    return success;
}

function run() {
    let repoRoot;
    try {
        repoRoot = getRepoRoot();
    } catch (e) {
        console.error(red('Error: Not inside a git repository.'));
        process.exit(1);
    }

    const config = loadConfig(repoRoot);
    const cmds = config.commands || {};

    let allPassed = true;

    // Run dependency validation first if it exists
    if (cmds.validateDeps) {
        const passed = runAndTruncate(cmds.validateDeps, process.cwd());
        if (passed === false) allPassed = false;
    }

    // Run typecheck
    if (cmds.typecheck) {
        const passed = runAndTruncate(cmds.typecheck, process.cwd());
        if (passed === false) allPassed = false;
    }

    if (!allPassed) {
        console.log(`\n${bold(red('Validation failed.'))} Please fix the errors above.`);
        process.exit(1);
    } else {
        console.log(`\n${bold(green('All validations passed cleanly!'))}`);
        process.exit(0);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    run();
}
