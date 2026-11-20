import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { expect, it } from 'vitest';

import { parseQualityReport, reconcileQualityBudget } from '../lintQualityBudget';
import { buildQualityLintArgv } from '../runLint';

const root = resolve(import.meta.dirname, '../..');

const fixture = `export function sortLabels(labels: ('track' | 'clip')[] | ('open' | 'closed')[]) {
    labels.sort();
}

export function removeListeners(target: EventTarget, handler: EventListener, object: EventListenerObject) {
    const bound = handler.bind(target);
    target.addEventListener('click', bound);
    target.removeEventListener('click', bound);
    target.removeEventListener('click', object, { capture: true });
    target.removeEventListener('click', () => handler(new Event('click')));
    target.removeEventListener('click', handler.bind(target));
}
`;

function writeFixtureProject(directory: string, files: string[]): string[] {
    writeFileSync(
        join(directory, 'tsconfig.json'),
        JSON.stringify({ extends: join(root, 'tsconfig.json'), files, include: [], exclude: [] })
    );
    return files.map((file) => {
        const path = join(directory, file);
        writeFileSync(path, fixture);
        return relative(root, path);
    });
}

it.each(['check', '--fix'])(
    'reports only invalid product listener removal without editing files in %s mode',
    (mode) => {
        const productDirectory = mkdtempSync(join(root, 'src/lint-product-guardrails-'));
        const scriptDirectory = mkdtempSync(join(root, 'scripts/lint-product-guardrails-'));
        try {
            const targets = [
                ...writeFixtureProject(productDirectory, ['product.ts', 'product.spec.ts']),
                ...writeFixtureProject(scriptDirectory, ['tooling.ts']),
            ];
            const result = spawnSync(
                resolve(root, 'node_modules/.bin/oxlint'),
                [...buildQualityLintArgv(targets).slice(2), ...(mode === '--fix' ? [mode] : [])],
                { cwd: root, encoding: 'utf8', timeout: 30_000 }
            );
            expect(result.error).toBeUndefined();
            const report = parseQualityReport(result.stdout, root);
            expect(report.fileCount).toBe(targets.length);
            const listener = 'unicorn/no-invalid-remove-event-listener';
            expect(
                report.diagnostics
                    .toSorted((a, b) => (a.line ?? 0) - (b.line ?? 0))
                    .map(({ file, rule, line, column, severity }) => [file, rule, line, column, severity])
            ).toEqual([
                [targets[0], listener, 10, 12, 'error'],
                [targets[0], listener, 11, 12, 'error'],
            ]);
            expect(result.status, result.stdout + result.stderr).toBe(1);
            expect(reconcileQualityBudget(report, new Map(), targets, root).failed).toBe(true);
            expect(targets.map((target) => readFileSync(resolve(root, target), 'utf8'))).toEqual([
                fixture,
                fixture,
                fixture,
            ]);
        } finally {
            rmSync(productDirectory, { recursive: true, force: true });
            rmSync(scriptDirectory, { recursive: true, force: true });
        }
    },
    45_000
);
