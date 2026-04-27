#!/usr/bin/env node

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
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

    console.log(cyan(`\nChecking for outdated dependencies...\n`));

    const pkgPath = join(repoRoot, 'package.json');
    if (!existsSync(pkgPath)) {
        console.error(red(`No package.json found.`));
        process.exit(1);
    }

    // Run pnpm outdated --json or npm outdated --json
    const res = spawnSync('npm', ['outdated', '--json'], { cwd: repoRoot, encoding: 'utf8' });
    let outdated = {};

    try {
        if (res.stdout) outdated = JSON.parse(res.stdout);
    } catch (e) {
        console.error(yellow(`Failed to parse npm outdated output. Make sure dependencies are installed.`));
        process.exit(1);
    }

    const packages = Object.keys(outdated);
    if (packages.length === 0) {
        console.log(green(`✓ All dependencies are up to date.`));
        process.exit(0);
    }

    console.log(yellow(`Found ${packages.length} outdated packages.`));

    const tasksDir = join(repoRoot, '.agents', 'tasks');
    if (!existsSync(tasksDir)) mkdirSync(tasksDir, { recursive: true });

    const epicSlug = `deps-upgrade-${Date.now()}`;

    packages.forEach((pkg) => {
        const info = outdated[pkg];
        const taskSlug = `upgrade-${pkg.replace(/[^a-zA-Z0-9-]/g, '-')}-${info.latest}`;
        const taskPath = join(tasksDir, `${taskSlug}.md`);

        const template = `# Upgrade ${pkg}

## Metadata

- Slug: ${taskSlug}
- Parent: ${epicSlug}
- Type: chore

---

## Objective

Intelligently upgrade \`${pkg}\` from \`${info.current}\` to \`${info.latest}\`.

## Plan
1. Use \`agents:web\` or curl to fetch the GitHub release notes for \`${pkg}\` version \`${info.latest}\`.
2. Analyze breaking changes.
3. Update \`package.json\` and run \`pnpm install\`.
4. Apply necessary API migrations in \`src/\`.
5. Run \`pnpm test\` to verify.

## Progress checklist

- [ ] Release notes analyzed
- [ ] Dependencies updated
- [ ] Code migrated
- [ ] Tests passing

`;
        writeFileSync(taskPath, template, 'utf8');
        console.log(green(`  ✓ Created task: `) + dim(taskSlug));
    });

    console.log(cyan(`\nDelegated to ${packages.length} separate upgrade tasks.`));
    console.log('');
}

if (import.meta.url === `file://${process.argv[1]}`) {
    run();
}
