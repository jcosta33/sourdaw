#!/usr/bin/env node

import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join, basename } from 'path';
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
    const targetFunc = positional[1];
    
    if (!targetFile || !targetFunc) {
        console.log(red('Usage: agents:fuzz <file> <functionName>'));
        process.exit(1);
    }

    const fullPath = join(repoRoot, targetFile);
    if (!existsSync(fullPath)) {
        console.error(red(`File not found: ${targetFile}`));
        process.exit(1);
    }

    console.log(cyan(`\nGenerating Auto-Fuzzer Suite for ${bold(targetFunc)}...\n`));

    const content = readFileSync(fullPath, 'utf8');
    if (!content.includes(targetFunc)) {
        console.log(red(`Function ${targetFunc} not found in ${targetFile}.`));
        process.exit(1);
    }

    const testDir = join(repoRoot, targetFile.substring(0, targetFile.lastIndexOf('/')), '__tests__');
    if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true });

    const specFile = join(testDir, `${targetFunc}.fuzz.spec.ts`);

    const template = `import { describe, it, expect } from 'vitest';
import { ${targetFunc} } from '../${basename(targetFile, '.ts')}';

describe('${targetFunc} Fuzzer', () => {
    it('handles unexpected nulls', () => {
        expect(() => ${targetFunc}(null as any)).not.toThrowError(/cannot read properties of null/i);
    });

    it('handles undefined', () => {
        expect(() => ${targetFunc}(undefined as any)).not.toThrowError(/cannot read properties of undefined/i);
    });

    it('handles massive arrays/strings', () => {
        const payload = 'A'.repeat(1000000);
        expect(() => ${targetFunc}(payload as any)).not.toThrowError(/maximum call stack size exceeded/i);
    });

    it('handles cyclic objects', () => {
        const a: any = {};
        a.a = a;
        expect(() => ${targetFunc}(a)).not.toThrowError(/maximum call stack size exceeded/i);
    });

    it('handles NaN and Infinity', () => {
        expect(() => ${targetFunc}(NaN as any)).not.toThrow();
        expect(() => ${targetFunc}(Infinity as any)).not.toThrow();
    });
});
`;
    
    writeFileSync(specFile, template, 'utf8');

    console.log(green(`✓ Fuzzer suite created: ${specFile.replace(repoRoot + '/', '')}`));
    console.log(dim(`Run 'pnpm vitest ${basename(specFile)}' to execute the chaos suite.`));
    console.log('');
}

if (import.meta.url === `file://${process.argv[1]}`) {
    run();
}
