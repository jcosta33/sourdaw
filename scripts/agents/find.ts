#!/usr/bin/env node

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
    const queryType = positional[0];
    const queryTarget = positional[1];
    
    if (!queryType || !queryTarget) {
        console.log(red('Usage: agents:find <type> <target>'));
        console.log(dim('Types: class, interface, function, implements, extends'));
        console.log(dim('Example: agents:find implements TransportHandler'));
        process.exit(1);
    }

    console.log(cyan(`\nSemantic Search: ${bold(queryType)} ${bold(queryTarget)}...\n`));

    let regex = '';
    switch (queryType) {
        case 'class':
            regex = `class\\s+${queryTarget}\\b`;
            break;
        case 'interface':
            regex = `interface\\s+${queryTarget}\\b`;
            break;
        case 'function':
            regex = `function\\s+${queryTarget}\\b|const\\s+${queryTarget}\\s*=\\s*(\\(|async)`;
            break;
        case 'implements':
            regex = `class\\s+\\w+\\s+(implements|extends).*?\\b${queryTarget}\\b`;
            break;
        case 'extends':
            regex = `(class|interface)\\s+\\w+\\s+extends.*?\\b${queryTarget}\\b`;
            break;
        default:
            console.error(red(`Unknown query type: ${queryType}`));
            process.exit(1);
    }

    const res = spawnSync('git', ['grep', '-n', '-E', regex], { cwd: repoRoot, encoding: 'utf8' });
    
    if (res.status === 0 && res.stdout.trim()) {
        const lines = res.stdout.trim().split('\n');
        console.log(green(`✓ Found ${lines.length} match(es):`));
        lines.forEach(line => {
            const parts = line.split(':');
            const file = parts.shift();
            const lineNum = parts.shift();
            const content = parts.join(':');
            console.log(`  ${cyan(file)}:${yellow(lineNum)} ${dim(content.trim())}`);
        });
    } else {
        console.log(dim(`No matches found.`));
    }
    
    console.log('');
}

if (import.meta.url === `file://${process.argv[1]}`) {
    run();
}
