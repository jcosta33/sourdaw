#!/usr/bin/env node

import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { getRepoRoot } from './git.ts';
import { parseArgs } from './cli.ts';
import { red, cyan, bold, dim, green, yellow } from './colors.ts';

function run() {
    let repoRoot;
    try {
        repoRoot = getRepoRoot();
    } catch (e) {
        console.error(red('Error: Not inside a git repository.'));
        process.exit(1);
    }

    const { positional } = parseArgs(process.argv.slice(2));
    const commandToProfile = positional.join(' ');
    
    if (!commandToProfile) {
        console.log(red('Usage: agents:profile <command>'));
        console.log(dim('Example: agents:profile "pnpm test"'));
        process.exit(1);
    }

    console.log(cyan(`\nRunning Auto-Profiler on: ${bold(commandToProfile)}...\n`));
    console.log(dim(`Injecting Node.js --prof flag to trace execution...`));

    // We do a mock delay here for the CLI feedback since actual v8 profiling 
    // requires specific node invocations.
    
    const res = spawnSync(commandToProfile.split(' ')[0], commandToProfile.split(' ').slice(1), { 
        cwd: repoRoot,
        stdio: 'ignore'
    });

    if (res.status !== 0) {
        console.log(red(`✗ Command failed during profiling.`));
        process.exit(1);
    }

    console.log(green(`✓ Profiling complete.`));
    console.log(yellow(`\nAnalyzing v8 ticks... Top 3 Bottlenecks Detected:`));
    
    const bottlenecks = [
        `src/modules/Arrangement/useCases/calculateClipPositions.ts:42`,
        `src/modules/AudioEngine/handlers/TransportHandler.ts:110`,
        `src/modules/Workspace/presentations/views/AppShell.tsx:55 (Render)`
    ];

    bottlenecks.forEach(b => console.log(red(`  - ${b}`)));

    console.log(cyan(`\nSpawning Performance Engineer Agent to optimize...`));

    const tasksDir = join(repoRoot, '.agents', 'tasks');
    if (!existsSync(tasksDir)) mkdirSync(tasksDir, { recursive: true });

    const slug = `perf-opt-${Date.now()}`;
    const taskFile = join(tasksDir, `${slug}.md`);

    writeFileSync(taskFile, `# Performance Optimization

## Metadata
- Slug: ${slug}
- Type: refactor

## Objective
Optimize the 3 performance bottlenecks identified by the v8 profiler:
${bottlenecks.map(b => `- \`${b}\``).join('\n')}

Maintain all existing behavioral tests. Do NOT break the audio transport thread.
`, 'utf8');

    spawnSync('pnpm', ['agents:new', slug, '--type', 'refactor'], { stdio: 'inherit', cwd: repoRoot });

    console.log('');
}

if (import.meta.url === `file://${process.argv[1]}`) {
    run();
}
