#!/usr/bin/env node

import { readFileSync, existsSync, statSync, readdirSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getRepoRoot } from './git.ts';
import { parseArgs } from './cli.ts';
import { red, cyan, bold, dim, green, yellow } from './colors.ts';

function findFiles(dir) {
    let results = [];
    try {
        const entries = readdirSync(dir);
        for (const entry of entries) {
            if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
            const fullPath = join(dir, entry);
            if (statSync(fullPath).isDirectory()) {
                results = results.concat(findFiles(fullPath));
            } else if (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx') || fullPath.endsWith('.js') || fullPath.endsWith('.jsx')) {
                results.push(fullPath);
            }
        }
    } catch (e) {
        // Ignore
    }
    return results;
}

function run() {
    let repoRoot;
    try {
        repoRoot = getRepoRoot();
    } catch (e) {
        console.error(red('Error: Not inside a git repository.'));
        process.exit(1);
    }

    const { positional, flags } = parseArgs(process.argv.slice(2));
    const targetDir = positional[0];
    const goal = positional.slice(1).join(' ') || flags.get('goal');
    
    if (!targetDir || !goal) {
        console.log(red('Usage: agents:refactor <directory> <goal>'));
        console.log(dim('Example: agents:refactor src/modules "Move all inline GraphQL to Repositories"'));
        process.exit(1);
    }

    const fullPath = join(repoRoot, targetDir);
    if (!existsSync(fullPath)) {
        console.error(red(`Directory not found: ${targetDir}`));
        process.exit(1);
    }

    console.log(cyan(`\nOrchestrating Large-Scale Refactor...\n`));
    console.log(dim(`Target: ${targetDir}`));
    console.log(dim(`Goal: ${goal}\n`));

    const files = findFiles(fullPath);
    if (files.length === 0) {
        console.log(yellow(`No source files found in ${targetDir}.`));
        process.exit(0);
    }

    console.log(`Found ${bold(files.length)} files. Chunking into bisectable tasks...`);

    const CHUNK_SIZE = 5; // Small chunks for safe parallel PRs
    const chunks = [];
    for (let i = 0; i < files.length; i += CHUNK_SIZE) {
        chunks.push(files.slice(i, i + CHUNK_SIZE));
    }

    const tasksDir = join(repoRoot, '.agents', 'tasks');
    if (!existsSync(tasksDir)) mkdirSync(tasksDir, { recursive: true });

    const epicSlug = `refactor-${Date.now()}`;

    chunks.forEach((chunk, index) => {
        const taskSlug = `${epicSlug}-chunk-${index + 1}`;
        const taskPath = join(tasksDir, `${taskSlug}.md`);
        
        const relativeFiles = chunk.map(f => f.replace(repoRoot + '/', ''));
        
        const template = `# Refactor Chunk ${index + 1}

## Metadata

- Slug: ${taskSlug}
- Parent: ${epicSlug}
- Type: refactor

---

## Objective

${goal}

Apply this refactoring ONLY to the following files:
${relativeFiles.map(f => `- ${f}`).join('\n')}

## Progress checklist

- [ ] Refactor applied
- [ ] Tests passing
- [ ] agents:validate passing

## Next steps
- Read the files, apply the refactor, and generate a PR.
`;
        writeFileSync(taskPath, template, 'utf8');
        console.log(green(`  ✓ Created task `) + dim(taskSlug) + dim(` (${chunk.length} files)`));
    });

    console.log(cyan(`\nRefactor split into ${chunks.length} tasks. Ready for worker agents.`));
    console.log(dim(`Use 'pnpm agents:new <slug>' to start processing.`));
    console.log('');
}

if (import.meta.url === `file://${process.argv[1]}`) {
    run();
}
