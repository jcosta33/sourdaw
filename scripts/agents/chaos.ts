#!/usr/bin/env node

import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
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

    const { positional, flags } = parseArgs(process.argv.slice(2));
    const command = positional[0];
    
    const envFile = join(repoRoot, '.env.local');

    console.log(cyan(`\nConfiguring Chaos Monkey Environment...\n`));

    if (command === 'start') {
        const delay = flags.get('delay') || '2000';
        const failRate = flags.get('fail-rate') || '0.2';
        
        let envContent = '';
        if (existsSync(envFile)) envContent = readFileSync(envFile, 'utf8');

        // Remove old chaos variables
        envContent = envContent.split('\n').filter(l => !l.startsWith('VITE_CHAOS_')).join('\n');
        
        envContent += `\nVITE_CHAOS_LATENCY=${delay}\nVITE_CHAOS_FAIL_RATE=${failRate}\n`;
        writeFileSync(envFile, envContent.trim() + '\n', 'utf8');
        
        console.log(yellow(`⚠ Chaos Monkey INJECTED.`));
        console.log(dim(`- Latency: ${delay}ms`));
        console.log(dim(`- Failure Rate: ${parseFloat(failRate) * 100}%`));
        console.log(dim(`All \`fetch\` wrappers will now randomly drop and delay requests.`));
        
    } else if (command === 'stop') {
        if (existsSync(envFile)) {
            let envContent = readFileSync(envFile, 'utf8');
            envContent = envContent.split('\n').filter(l => !l.startsWith('VITE_CHAOS_')).join('\n');
            writeFileSync(envFile, envContent.trim() + '\n', 'utf8');
        }
        console.log(green(`✓ Chaos Monkey STOPPED.`));
        console.log(dim(`Development environment returned to normal.`));
    } else {
        console.log(red('Usage: agents:chaos <start|stop> [--delay 2000] [--fail-rate 0.2]'));
        process.exit(1);
    }
    console.log('');
}

if (import.meta.url === `file://${process.argv[1]}`) {
    run();
}
