#!/usr/bin/env node

import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { getRepoRoot } from './git.ts';
import { parseArgs } from './cli.ts';
import { red, cyan, bold, dim, green } from './colors.ts';

function run() {
    let repoRoot;
    try {
        repoRoot = getRepoRoot();
    } catch (e) {
        console.error(red('Error: Not inside a git repository.'));
        process.exit(1);
    }

    const { positional } = parseArgs(process.argv.slice(2));
    const targetSlug = positional[0];

    if (!targetSlug) {
        console.log(red('Usage: agents:review <slug-to-review>'));
        process.exit(1);
    }

    console.log(cyan(`\nRequesting Peer Review for: ${bold(targetSlug)}...`));

    // First check if the branch exists
    const branchName = `agents/${targetSlug}`;
    const checkBranch = spawnSync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], {
        cwd: repoRoot,
    });
    if (checkBranch.status !== 0) {
        console.error(red(`Branch ${branchName} does not exist. Cannot review.`));
        process.exit(1);
    }

    // Launch a new agent targeting that branch as its base
    const reviewSlug = `${targetSlug}-review`;

    console.log(dim(`Spawning adversarial reviewer: ${reviewSlug} (Base: ${branchName})`));

    // Create a specific review task
    const tasksDir = join(repoRoot, '.agents', 'tasks');
    if (!existsSync(tasksDir)) mkdirSync(tasksDir, { recursive: true });

    const taskPath = join(tasksDir, `${reviewSlug}.md`);
    const template = `# Review: ${targetSlug}

## Metadata

- Slug: ${reviewSlug}
- Agent: claude
- Parent: ${targetSlug}

---

> **PERSONA:** Adopt **The Skeptic** stance — see the workspace persona guides under \`../sourdaw-hq/.agents/skills/\`.
> **MANDATE:** You are the adversarial reviewer for branch \`${branchName}\`. 
> 1. Run \`git diff main...HEAD\` to see what the original agent changed.
> 2. Run the tests. Check the blast radius. Look for architectural violations.
> 3. You MUST either approve the PR by closing this task, or leave feedback in this task file and FAIL.

## Objective
Review the changes made in \`${targetSlug}\` and ensure they are flawless.
`;
    writeFileSync(taskPath, template, 'utf8');

    // Automatically invoke agents:new
    const res = spawnSync('pnpm', ['agents:new', reviewSlug, '--base', branchName], {
        stdio: 'inherit',
        cwd: repoRoot,
    });

    if (res.status === 0) {
        console.log(green(`\n✓ Reviewer agent launched successfully.`));
    } else {
        console.error(red(`\n✗ Failed to launch reviewer agent.`));
        process.exit(1);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    run();
}
