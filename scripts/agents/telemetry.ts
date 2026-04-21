#!/usr/bin/env node

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
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

    console.log(cyan(`\n📊 Swarm Telemetry Dashboard\n`));

    const statePath = join(repoRoot, '.agents', 'state.json');
    if (!existsSync(statePath)) {
        console.log(yellow(`No swarm telemetry data available. (.agents/state.json not found)`));
        process.exit(0);
    }

    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    const slugs = Object.keys(state);

    if (slugs.length === 0) {
        console.log(dim(`Swarm is currently idle and has no historical data.`));
        process.exit(0);
    }

    let activeCount = 0;
    let completedCount = 0;
    let crashedCount = 0;

    slugs.forEach(slug => {
        const info = state[slug];
        if (info.status === 'running') activeCount++;
        else if (info.status === 'crashed') crashedCount++;
        else completedCount++;
    });

    console.log(bold(`Global Metrics:`));
    console.log(`  Total Agents Spawned: ${slugs.length}`);
    console.log(`  Active Agents:        ${green(activeCount.toString())}`);
    console.log(`  Completed Tasks:      ${cyan(completedCount.toString())}`);
    console.log(`  Crashed/Failed:       ${crashedCount > 0 ? red(crashedCount.toString()) : green('0')}`);
    
    console.log(`\n${bold(`Recent Execution Logs:`)}`);
    
    slugs.slice(-5).forEach(slug => {
        const info = state[slug];
        const statusStr = info.status === 'running' ? green('[RUNNING]') : 
                          info.status === 'crashed' ? red('[CRASHED]') : dim(`[${info.status?.toUpperCase() || 'UNKNOWN'}]`);
        
        console.log(`  ${statusStr} ${cyan(slug)}`);
        console.log(dim(`    Backend: ${info.backend || 'unknown'}, Agent Type: ${info.agent || 'default'}`));
    });

    console.log('');
}

if (import.meta.url === `file://${process.argv[1]}`) {
    run();
}
