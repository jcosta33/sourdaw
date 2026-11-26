import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { expect, it } from 'vitest';

import { parseQualityReport, readQualityBudget, reconcileQualityBudget } from '../lintQualityBudget';
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

function writeFixtureProject(directory: string, files: string[], source: string): string[] {
    writeFileSync(
        join(directory, 'tsconfig.json'),
        JSON.stringify({ extends: join(root, 'tsconfig.json'), files, include: [], exclude: [] })
    );
    return files.map((file) => {
        const path = join(directory, file);
        writeFileSync(path, source);
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
                ...writeFixtureProject(productDirectory, ['product.ts', 'product.spec.ts'], fixture),
                ...writeFixtureProject(scriptDirectory, ['tooling.ts'], fixture),
            ];
            const argv = buildQualityLintArgv(targets).slice(2);
            if (mode === '--fix') {
                argv.push(mode);
            }
            const result = spawnSync(resolve(root, 'node_modules/.bin/oxlint'), argv, {
                cwd: root,
                encoding: 'utf8',
                timeout: 30_000,
            });
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

it('reports global primitive wrappers through the read-only product quality pass', () => {
    const source = `export function boxed() {
    return [new Boolean(false), new String('track'), new Number(0)];
}

export function conversions(value: string) {
    return [Boolean(value), String(value), Number(value), Object(false)];
}

export function localConstructor() {
    class Boolean {}
    return new Boolean();
}
`;
    const productDirectory = mkdtempSync(join(root, 'src/lint-product-guardrails-'));
    const scriptDirectory = mkdtempSync(join(root, 'scripts/lint-product-guardrails-'));
    try {
        const targets = [
            ...writeFixtureProject(productDirectory, ['product.ts', 'product.spec.ts'], source),
            ...writeFixtureProject(scriptDirectory, ['tooling.ts'], source),
        ];
        const result = spawnSync(resolve(root, 'node_modules/.bin/oxlint'), buildQualityLintArgv(targets).slice(2), {
            cwd: root,
            encoding: 'utf8',
            timeout: 30_000,
        });
        expect(result.error).toBeUndefined();
        const report = parseQualityReport(result.stdout, root);
        expect(report.fileCount).toBe(targets.length);
        expect(
            report.diagnostics
                .toSorted((a, b) => (a.column ?? 0) - (b.column ?? 0))
                .map(({ file, rule, line, column, severity }) => [file, rule, line, column, severity])
        ).toEqual([
            [targets[0], 'eslint/no-new-wrappers', 2, 13, 'error'],
            [targets[0], 'eslint/no-new-wrappers', 2, 33, 'error'],
            [targets[0], 'eslint/no-new-wrappers', 2, 54, 'error'],
        ]);
        expect(result.status, result.stdout + result.stderr).toBe(1);
        expect(reconcileQualityBudget(report, new Map(), targets, root).failed).toBe(true);
        expect(targets.map((target) => readFileSync(resolve(root, target), 'utf8'))).toEqual(targets.map(() => source));
    } finally {
        rmSync(productDirectory, { recursive: true, force: true });
        rmSync(scriptDirectory, { recursive: true, force: true });
    }
}, 45_000);

it('reports a lone if in an else block across shared handwritten product layers', () => {
    const source = `export function selectTrack(flags: { primary: boolean; fallback: boolean }, update: (id: string) => void) {
    if (flags.primary) {
        update('primary');
    } else {
        // Only use the fallback when it is ready.
        if (flags.fallback) update('fallback')
    }
    ['done'].forEach(update);
}

export function keepMeaningfulBranches(flags: { primary: boolean; fallback: boolean }, update: (id: string) => void) {
    if (flags.primary) {
        update('primary');
    } else if (flags.fallback) {
        update('fallback');
    }
    if (flags.primary) {
        if (flags.fallback) update('nested');
    } else {
        const id = 'secondary';
        if (flags.fallback) update(id);
    }
}

export function keepNestedIf(flags: { primary: boolean; fallback: boolean }, update: (id: string) => void) {
    if (flags.primary) {
        if (flags.fallback) update('nested');
    }
}

export function unavailable(): number | undefined {
    return;
}
`;
    const directories: string[] = [];
    try {
        const layers = ['src/app', 'src/helpers', 'src/infra', 'src/routes', 'src/utils'];
        const productTargets = layers.flatMap((layer) => {
            const directory = mkdtempSync(join(root, layer, 'lint-product-guardrails-'));
            directories.push(directory);
            const file = layer === 'src/routes' ? 'product.tsx' : 'product.ts';
            return writeFixtureProject(directory, [file], source);
        });
        const testDirectory = mkdtempSync(join(root, 'src/utils/lint-product-guardrails-'));
        directories.push(testDirectory);
        const otherProductDirectory = mkdtempSync(join(root, 'src/lint-product-guardrails-'));
        directories.push(otherProductDirectory);
        const targets = [
            ...productTargets,
            ...writeFixtureProject(testDirectory, ['product.spec.ts'], source),
            ...writeFixtureProject(otherProductDirectory, ['product.ts'], source),
        ];
        const result = spawnSync(resolve(root, 'node_modules/.bin/oxlint'), buildQualityLintArgv(targets).slice(2), {
            cwd: root,
            encoding: 'utf8',
            timeout: 30_000,
        });
        expect(result.error).toBeUndefined();
        const report = parseQualityReport(result.stdout, root);
        expect(report.fileCount).toBe(targets.length);
        const rule = 'eslint/no-lonely-if';
        expect(
            report.diagnostics
                .toSorted((a, b) => a.file.localeCompare(b.file))
                .map(({ file, rule, line, column, severity }) => [file, rule, line, column, severity])
        ).toEqual(productTargets.map((target) => [target, rule, 6, 9, 'error']));
        expect(result.status, result.stdout + result.stderr).toBe(1);
        const budget = readQualityBudget(root);
        expect([...budget.values()].some((rules) => rules.has(rule))).toBe(false);
        expect(reconcileQualityBudget(report, budget, targets, root).failed).toBe(true);
        expect(targets.map((target) => readFileSync(resolve(root, target), 'utf8'))).toEqual(targets.map(() => source));
    } finally {
        for (const directory of directories) {
            rmSync(directory, { recursive: true, force: true });
        }
    }
}, 45_000);
