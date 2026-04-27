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

    console.log(cyan(`\nEnforcing Test-Driven Auto-Repro...\n`));

    // Get modified files in worktree
    const res = spawnSync('git', ['diff', 'HEAD', '--name-only'], { cwd: repoRoot, encoding: 'utf8' });
    if (res.status !== 0) {
        console.error(red('Failed to run git diff.'));
        process.exit(1);
    }

    const modifiedFiles = res.stdout.trim().split('\n').filter(Boolean);

    const srcFiles = modifiedFiles.filter(
        (f) => f.startsWith('src/') && !f.endsWith('.spec.ts') && !f.endsWith('.spec.tsx')
    );
    const specFiles = modifiedFiles.filter((f) => f.endsWith('.spec.ts') || f.endsWith('.spec.tsx'));

    if (srcFiles.length > 0 && specFiles.length === 0) {
        console.log(red(`✗ TDD Violation Detected!`));
        console.log(yellow(`  You have modified ${srcFiles.length} source file(s), but ZERO test files.`));
        console.log(dim(`  Modified: \n    - ${srcFiles.join('\n    - ')}\n`));
        console.log(
            bold(
                `  MANDATE: You MUST write a failing test (.spec.ts) that reproduces the bug before modifying source code.`
            )
        );
        process.exit(1);
    }

    if (specFiles.length > 0) {
        console.log(green(`✓ Test file modified (`) + dim(specFiles[0]) + green(`). TDD check passed.`));
    } else {
        console.log(dim(`No source code changes detected yet.`));
    }

    console.log('');
}

if (import.meta.url === `file://${process.argv[1]}`) {
    run();
}
