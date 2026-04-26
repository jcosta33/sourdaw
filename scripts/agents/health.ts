#!/usr/bin/env node

import { spawnSync } from 'child_process';
import { existsSync, statSync } from 'fs';
import { join } from 'path';
import { getRepoRoot } from './git.ts';
import { cyan, bold, green, red, yellow, dim } from './colors.ts';

function checkCommand(cmd, args) {
    const res = spawnSync(cmd, args, { encoding: 'utf8' });
    if (res.status === 0) {
        return { ok: true, version: res.stdout.trim().split('\n')[0] };
    }
    return { ok: false, error: res.stderr || 'Command failed' };
}

function checkDirSize(dirPath) {
    if (!existsSync(dirPath)) return 0;
    let size = 0;
    try {
        const stats = statSync(dirPath);
        if (stats.isDirectory()) {
            const files = require('fs').readdirSync(dirPath);
            files.forEach(file => {
                size += checkDirSize(join(dirPath, file));
            });
        } else {
            size += stats.size;
        }
    } catch (e) {
        // ignore permissions
    }
    return size;
}

function run() {
    console.log(cyan(`\n🩺 Swarm Health Check\n`));

    let repoRoot;
    try {
        repoRoot = getRepoRoot();
        console.log(green(`✓ Git Workspace:`), dim(repoRoot));
    } catch (e) {
        console.log(red(`✗ Git Workspace:`), 'Not a git repository.');
        process.exit(1);
    }

    // Node version
    const nodeCheck = checkCommand('node', ['-v']);
    if (nodeCheck.ok) console.log(green(`✓ Node:`), dim(nodeCheck.version));
    else console.log(red(`✗ Node:`), nodeCheck.error);

    // Git version
    const gitCheck = checkCommand('git', ['--version']);
    if (gitCheck.ok) console.log(green(`✓ Git:`), dim(gitCheck.version));
    else console.log(red(`✗ Git:`), gitCheck.error);

    // PNPM version
    const pnpmCheck = checkCommand('pnpm', ['-v']);
    if (pnpmCheck.ok) console.log(green(`✓ PNPM:`), dim(pnpmCheck.version));
    else console.log(yellow(`⚠ PNPM:`), 'Not found, falling back to npm maybe?');

    // Agents storage size
    const agentsDir = join(repoRoot, '.agents');
    if (existsSync(agentsDir)) {
        console.log(green(`✓ Swarm Storage:`), dim(`.agents directory exists.`));
    } else {
        console.log(yellow(`⚠ Swarm Storage:`), dim(`.agents directory does not exist yet.`));
    }

    console.log(cyan(`\nAll pre-flight checks complete.\n`));
}

if (import.meta.url === `file://${process.argv[1]}`) {
    run();
}
