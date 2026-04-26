#!/usr/bin/env node

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
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

    const { positional, flags } = parseArgs(process.argv.slice(2));
    const rawFile = positional[0];
    const slug = flags.get('slug') || basename(rawFile || 'bug', '.txt');
    
    if (!rawFile) {
        console.log(red('Usage: agents:triage <path/to/raw-report.txt> [--slug my-bug-slug]'));
        process.exit(1);
    }

    const fullPath = join(repoRoot, rawFile);
    if (!existsSync(fullPath)) {
        console.error(red(`File not found: ${rawFile}`));
        process.exit(1);
    }

    const content = readFileSync(fullPath, 'utf8');

    const specsDir = join(repoRoot, '.agents', 'specs');
    if (!existsSync(specsDir)) mkdirSync(specsDir, { recursive: true });

    const specPath = join(specsDir, `${slug}.md`);

    console.log(cyan(`\nTriaging bug report into spec: ${bold(slug)}...`));

    const template = `# Bug: ${slug}

## Raw Report
> The following is the unstructured report. Do NOT fix the code until you have translated this into verifiable reproduction steps and acceptance criteria.

\`\`\`text
${content}
\`\`\`

---

## Reproduction Steps
1. [Agent to fill this out]
2. ...

## Acceptance Criteria
<acceptance_criteria>

- [ ] [Agent to define criteria]
- [ ] ...

</acceptance_criteria>

## Technical Constraints
- Must include a new test case validating the fix.
`;

    writeFileSync(specPath, template, 'utf8');
    console.log(green(`  ✓ Created spec: `) + dim(specPath));
    console.log(dim(`  (Agent should now read the spec, fill in the repro steps, and proceed)`));
    console.log('');
}

if (import.meta.url === `file://${process.argv[1]}`) {
    run();
}
