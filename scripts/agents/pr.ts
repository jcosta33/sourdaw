#!/usr/bin/env node

import { spawnSync } from 'child_process';
import { join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { getRepoRoot } from './git.ts';
import { parseArgs } from './cli.ts';
import { red, green, cyan, bold, yellow } from './colors.ts';

function findWorktreePath(slug, repoRoot) {
    const list = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).stdout;
    const worktreeMatch = new RegExp(`^worktree (.+agents-${slug})$`, 'm').exec(list);
    return worktreeMatch ? worktreeMatch[1] : null;
}

function run() {
    let repoRoot;
    try {
        repoRoot = getRepoRoot();
    } catch (e) {
        console.error(red('Error: Not inside a git repository.'));
        process.exit(1);
    }

    const { flags, positional } = parseArgs(process.argv.slice(2));
    const slug = positional[0];
    
    if (!slug) {
        console.log(red('Usage: agents:pr <slug>'));
        process.exit(1);
    }

    const worktreeAbs = findWorktreePath(slug, repoRoot);
    if (!worktreeAbs) {
        console.error(red(`No active worktree found for "${slug}".`));
        process.exit(1);
    }

    const taskFile = join(worktreeAbs, '.agents', 'tasks', `${slug}.md`);
    if (!existsSync(taskFile)) {
        console.error(red(`Task file not found at ${taskFile}`));
        process.exit(1);
    }

    // Extract objective as PR title
    const content = readFileSync(taskFile, 'utf8');
    const objMatch = /## Objective\n+([^#]+)/.exec(content);
    const objective = objMatch ? objMatch[1].trim().split('\n')[0] : `Implement ${slug}`;

    console.log(cyan(`\nAuto-generating PR for ${bold(slug)}...`));
    console.log(dim(`Objective: ${objective}`));

    // Add changes
    spawnSync('git', ['add', '.'], { cwd: worktreeAbs });

    // Commit
    const commitMsg = `feat(${slug}): ${objective}\n\nAutomated commit via Swarm PR generator.`;
    const commitRes = spawnSync('git', ['commit', '-m', commitMsg], { cwd: worktreeAbs, stdio: 'inherit' });

    if (commitRes.status === 0) {
        console.log(green(`\n✓ Changes committed successfully.`));
        console.log(yellow(`To open the PR, push your branch: git push origin agents-${slug}`));
    } else {
        console.log(yellow(`\n✗ Git commit failed (maybe no changes to commit?).`));
    }
}

function dim(str) {
    return `\x1b[2m${str}\x1b[0m`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    run();
}
