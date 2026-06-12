#!/usr/bin/env node

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
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
    const interfaceName = positional[1];

    if (!targetFile || !interfaceName) {
        console.log(red('Usage: agents:mock <path/to/file.ts> <InterfaceName>'));
        process.exit(1);
    }

    const fullPath = join(repoRoot, targetFile);
    if (!existsSync(fullPath)) {
        console.error(red(`File not found: ${targetFile}`));
        process.exit(1);
    }

    const content = readFileSync(fullPath, 'utf8');

    // Very naive regex extraction of the interface block
    const interfaceRegex = new RegExp(`interface\\s+${interfaceName}\\s*(?:extends\\s+[^{]+)?\\s*\\{([^}]*)\\}`, 's');
    const match = content.match(interfaceRegex);

    console.log(cyan(`\nGenerating Mock Factory for ${bold(interfaceName)}...\n`));

    let mockProperties = `
        // TODO: Fill in default realistic mock values
    `;

    if (match && match[1]) {
        const body = match[1];
        // naive parse lines
        const lines = body
            .split('\n')
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith('//') && !l.startsWith('/*'));
        const props = [];
        for (const line of lines) {
            const propMatch = line.match(/^([a-zA-Z0-9_]+)\s*[\?\:]/);
            if (propMatch) {
                const prop = propMatch[1];
                let defaultVal = 'null';
                if (line.includes(': string')) defaultVal = `'mock_${prop}'`;
                else if (line.includes(': number')) defaultVal = '0';
                else if (line.includes(': boolean')) defaultVal = 'false';
                else if (line.includes('=>') || line.includes('()')) defaultVal = 'vi.fn()';
                else if (line.includes('[]') || line.includes('Array')) defaultVal = '[]';

                props.push(`        ${prop}: ${defaultVal},`);
            }
        }
        if (props.length > 0) {
            mockProperties = '\n' + props.join('\n') + '\n    ';
        }
    } else {
        console.log(dim(`(Could not perfectly parse interface body, providing generic template)`));
    }

    const factoryCode = `import { vi } from 'vitest';
import type { ${interfaceName} } from './${targetFile.split('/').pop()?.replace('.ts', '')}';

export const createMock${interfaceName} = (
    overrides?: Partial<${interfaceName}>
): ${interfaceName} => ({${mockProperties}...overrides,
});
`;

    console.log(green(factoryCode));
    console.log(dim(`\nCopy/paste this into your test file or a __mocks__ folder.`));
}

if (import.meta.url === `file://${process.argv[1]}`) {
    run();
}
