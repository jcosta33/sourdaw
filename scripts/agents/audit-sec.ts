#!/usr/bin/env node

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getRepoRoot } from './git.ts';
import { parseArgs } from './cli.ts';
import { red, cyan, bold, dim, green, yellow } from './colors.ts';

const RISKY_PATTERNS = [
    { regex: /\beval\s*\(/g, description: 'Usage of eval() is highly dangerous.' },
    { regex: /dangerouslySetInnerHTML/g, description: 'React dangerouslySetInnerHTML found. XSS risk.' },
    {
        regex: /localStorage\.setItem\(\s*['"]token['"]/g,
        description: 'Storing auth tokens in localStorage exposes them to XSS.',
    },
    { regex: /\bAPI_KEY\s*=/g, description: 'Potential hardcoded API_KEY detected.' },
    { regex: /\bSECRET\s*=/g, description: 'Potential hardcoded SECRET detected.' },
];

function auditSecurity(content) {
    const lines = content.split('\n');
    const issues = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        for (const pattern of RISKY_PATTERNS) {
            if (pattern.regex.test(line)) {
                issues.push({
                    line: i + 1,
                    text: line.trim(),
                    description: pattern.description,
                });
            }
        }
    }
    return issues;
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
        console.log(red('Usage: agents:audit-sec <path/to/file.ts>'));
        process.exit(1);
    }

    const fullPath = join(repoRoot, targetFile);
    if (!existsSync(fullPath)) {
        console.error(red(`File not found: ${targetFile}`));
        process.exit(1);
    }

    const content = readFileSync(fullPath, 'utf8');
    const issues = auditSecurity(content);

    console.log(cyan(`\nSecurity Audit for ${bold(targetFile)}:`));

    if (issues.length === 0) {
        console.log(green(`✓ No obvious security vulnerabilities found.`));
    } else {
        console.log(red(`✗ Found ${issues.length} potential security risks:`));
        issues.forEach((issue) => {
            console.log(`  Line ${cyan(issue.line)}: ${yellow(issue.description)}`);
            console.log(dim(`    > ${issue.text}`));
        });
        process.exit(1); // Fail the script
    }
    console.log('');
}

if (import.meta.url === `file://${process.argv[1]}`) {
    run();
}
