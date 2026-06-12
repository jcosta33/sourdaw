#!/usr/bin/env node

import { spawnSync } from 'child_process';
import { getRepoRoot } from './git.ts';
import { red, cyan, bold, dim, green, yellow } from './colors.ts';

function run() {
    let repoRoot;
    try {
        repoRoot = getRepoRoot();
    } catch (e) {
        console.error(red('Error: Not inside a git repository.'));
        process.exit(1);
    }

    console.log(cyan(`\nChecking branch health...`));

    // First check if typecheck passes
    console.log(dim('Running pnpm typecheck...'));
    const typecheck = spawnSync('pnpm', ['typecheck'], { cwd: repoRoot, stdio: 'pipe', encoding: 'utf8' });

    if (typecheck.status === 0) {
        console.log(green(`✓ Branch is healthy. No healing required.`));
        process.exit(0);
    }

    console.log(red(`✗ Branch is broken (typecheck failed)!`));
    console.log(dim(`Triggering Self-Healing Protocol...`));

    const slug = `heal-${Date.now()}`;
    console.log(yellow(`Spawning emergency hotfix agent: ${bold(slug)}`));

    const res = spawnSync('pnpm', ['agents:new', slug, '--title', '"Emergency Typecheck Fix"', '--type', 'fix'], {
        cwd: repoRoot,
        stdio: 'inherit',
    });

    if (res.status === 0) {
        console.log(green(`\n✓ Heal agent spawned successfully.`));
        console.log(dim(`The agent should now fix the type errors and run agents:pr`));
    } else {
        console.log(red(`\n✗ Failed to spawn heal agent.`));
        process.exit(1);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    run();
}
