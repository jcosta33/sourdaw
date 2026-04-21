#!/usr/bin/env node

import { spawnSync } from 'child_process';
import { getRepoRoot } from './git.ts';
import { red, green, yellow, bold, cyan } from './colors.ts';
import { parseArgs } from './cli.ts';
import { join, basename, dirname } from 'path';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';

function findImpactedSpecs(repoRoot, targetFile) {
    const targetName = basename(targetFile, '.ts').replace('.tsx', '');
    const specs = [];
    
    // Very naive blast radius: find any .spec.ts or .spec.tsx files that import the targetName
    // In a real swarm this uses `dependency-cruiser` or a TS Language Service AST graph.
    function scan(dir) {
        try {
            const entries = readdirSync(dir);
            for (const entry of entries) {
                if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
                const fullPath = join(dir, entry);
                if (statSync(fullPath).isDirectory()) {
                    scan(fullPath);
                } else if (fullPath.endsWith('.spec.ts') || fullPath.endsWith('.spec.tsx')) {
                    const content = readFileSync(fullPath, 'utf8');
                    // Check if spec imports the target module
                    if (content.includes(targetName)) {
                        specs.push(fullPath);
                    }
                }
            }
        } catch (e) {
            // ignore
        }
    }
    
    scan(join(repoRoot, 'src'));
    
    // Also include the spec file adjacent to the target if it exists
    const adjacentSpecTs = join(dirname(targetFile), `__tests__`, `${targetName}.spec.ts`);
    const adjacentSpecTsx = join(dirname(targetFile), `__tests__`, `${targetName}.spec.tsx`);
    if (existsSync(adjacentSpecTs) && !specs.includes(adjacentSpecTs)) specs.push(adjacentSpecTs);
    if (existsSync(adjacentSpecTsx) && !specs.includes(adjacentSpecTsx)) specs.push(adjacentSpecTsx);

    return specs;
}

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
    
    if (!targetFile) {
        console.log(red('Usage: agents:test-radius <path/to/modified/file.ts>'));
        process.exit(1);
    }

    console.log(cyan(`\nCalculating blast radius for: ${bold(targetFile)}...`));
    const impactedSpecs = findImpactedSpecs(repoRoot, join(repoRoot, targetFile));

    if (impactedSpecs.length === 0) {
        console.log(yellow(`No impacted spec files found. Blast radius is isolated.`));
        process.exit(0);
    }

    console.log(green(`Found ${impactedSpecs.length} impacted spec file(s). Running subset...`));
    impactedSpecs.forEach(s => console.log(dim(`  - ${s.replace(repoRoot + '/', '')}`)));

    // Run the unified test wrapper with the specific files
    const scriptPath = new URL('./test.ts', import.meta.url).pathname;
    const res = spawnSync(process.execPath, ['--experimental-strip-types', scriptPath, ...impactedSpecs], { stdio: 'inherit' });
    process.exit(res.status || 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    run();
}
