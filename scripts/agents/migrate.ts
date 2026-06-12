#!/usr/bin/env node

import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
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
    const targetFile = positional[0];
    const targetLang = positional[1] || 'Rust';

    if (!targetFile) {
        console.log(red('Usage: agents:migrate <file> [TargetLanguage]'));
        process.exit(1);
    }

    const fullPath = join(repoRoot, targetFile);
    if (!existsSync(fullPath)) {
        console.error(red(`File not found: ${targetFile}`));
        process.exit(1);
    }

    console.log(cyan(`\nInitializing Framework Translation Protocol...\n`));

    const baseName = basename(targetFile, '.ts');
    const translatorSlug = `translate-${baseName}`;
    const verifierSlug = `verify-${baseName}`;

    const tasksDir = join(repoRoot, '.agents', 'tasks');
    if (!existsSync(tasksDir)) mkdirSync(tasksDir, { recursive: true });

    // Translator Task
    const transTask = join(tasksDir, `${translatorSlug}.md`);
    writeFileSync(
        transTask,
        `# Translate ${baseName} to ${targetLang}

## Metadata
- Slug: ${translatorSlug}

## Objective
Rewrite \`${targetFile}\` entirely into ${targetLang}. Maintain exact behavioral parity. Do NOT alter the tests.
`,
        'utf8'
    );

    // Verifier Task
    const verTask = join(tasksDir, `${verifierSlug}.md`);
    writeFileSync(
        verTask,
        `# Verify Translation of ${baseName}

## Metadata
- Slug: ${verifierSlug}

## Objective
Wait for \`${translatorSlug}\` to finish. Run the test suite against the new ${targetLang} implementation. Find edge cases they missed.
`,
        'utf8'
    );

    console.log(green(`✓ Orchestration planned.`));
    console.log(dim(`  Translator: ${translatorSlug}`));
    console.log(dim(`  Verifier:   ${verifierSlug}`));

    // Spawn Translator
    console.log(cyan(`\nSpawning Translator Agent...`));
    spawnSync('pnpm', ['agents:new', translatorSlug, '--type', 'feature'], { stdio: 'inherit', cwd: repoRoot });
}

if (import.meta.url === `file://${process.argv[1]}`) {
    run();
}
