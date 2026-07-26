#!/usr/bin/env node
/**
 * Runs remove-inject-non-container codemod in dry-run mode and TypeScript-parses the printed output.
 * Use after changing the codemod to catch syntax breakage.
 *
 *   node scripts/verify-remove-inject-output.mjs path/to/file.ts [...]
 */

import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const root = dirname(fileURLToPath(import.meta.url));
const codemod = join(root, '..', 'codemods', 'remove-inject-non-container.ts');

function extractPrintedSource(jscodeshiftStdout) {
    const lines = jscodeshiftStdout.split('\n');
    const start = lines.findIndex((l) => /^(import |export |\/\*|const [a-zA-Z_]|type |interface |function )/.test(l));
    if (start < 0) {
        throw new Error('Could not find start of transformed source in jscodeshift output');
    }
    const endMarker = lines.findIndex((l, i) => i > start && l.startsWith('All done'));
    const slice = endMarker > start ? lines.slice(start, endMarker) : lines.slice(start);
    return slice.join('\n').replace(/\n+$/, '');
}

const files = process.argv.slice(2);
if (files.length === 0) {
    console.error('Usage: node scripts/verify-remove-inject-output.mjs <file.ts> [...]');
    process.exit(1);
}

let failed = false;
for (const file of files) {
    const out = execSync(`pnpm exec jscodeshift -t "${codemod}" "${file}" -d -p --parser=tsx --extensions=ts 2>&1`, {
        encoding: 'utf8',
        maxBuffer: 20 * 1024 * 1024,
    });
    const okMatch = out.match(/(\d+) ok/);
    const okCount = okMatch ? parseInt(okMatch[1], 10) : 0;
    if (okCount === 0) {
        console.log(`${file}: codemod did not transform (skipped pattern) — no parse check`);
        continue;
    }
    try {
        const code = extractPrintedSource(out);
        const sf = ts.createSourceFile(`${file}.out.ts`, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        const diags = sf.parseDiagnostics ?? [];
        const errs = diags.filter((d) => d.category === ts.DiagnosticCategory.Error);
        if (errs.length > 0) {
            console.error(`${file}: ${errs.length} parse error(s)`);
            console.error(
                ts.formatDiagnostic(errs[0], {
                    getCanonicalFileName: (f) => f,
                    getCurrentDirectory: () => '',
                    getNewLine: () => '\n',
                })
            );
            failed = true;
        } else {
            console.log(`${file}: parse ok (${sf.statements.length} top-level statements)`);
        }
    } catch (e) {
        console.error(`${file}:`, e.message);
        failed = true;
    }
}

process.exit(failed ? 1 : 0);
