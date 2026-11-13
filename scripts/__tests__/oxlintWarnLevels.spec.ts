import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const TRACKED_IN_6486 = 'existing violations remain; promotion or baselining tracked in #6486';

const ALLOWED_WARN_RULES: ReadonlyArray<readonly [entry: string, reason: string]> = [
    ['root:typescript/require-await', TRACKED_IN_6486],
    ['root:jsx-a11y/click-events-have-key-events', TRACKED_IN_6486],
    ['root:jsx-a11y/label-has-associated-control', TRACKED_IN_6486],
    ['root:jsx-a11y/no-static-element-interactions', TRACKED_IN_6486],
    ['**/*.spec.{ts,tsx}:typescript/no-explicit-any', TRACKED_IN_6486],
    ['**/*.spec.{ts,tsx}:typescript/no-unsafe-argument', TRACKED_IN_6486],
    ['**/*.spec.{ts,tsx}:typescript/no-unsafe-assignment', TRACKED_IN_6486],
    ['**/*.spec.{ts,tsx}:typescript/no-unsafe-call', TRACKED_IN_6486],
    ['**/*.spec.{ts,tsx}:typescript/no-unsafe-member-access', TRACKED_IN_6486],
    ['**/*.spec.{ts,tsx}:typescript/no-unsafe-return', TRACKED_IN_6486],
    ['**/*.spec.{ts,tsx}:typescript/no-floating-promises', TRACKED_IN_6486],
];

const BASELINED_RULES: readonly string[] = [
    'func-style',
    'promise/always-return',
    'typescript/no-unnecessary-condition',
    'typescript/prefer-promise-reject-errors',
    'typescript/restrict-template-expressions',
];

const GLOB_CHARACTERS = /[*?[\]{}!]/;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWarnSeverity(severity: unknown): boolean {
    return severity === 'warn' || severity === 1;
}

function isWarn(setting: unknown): boolean {
    return isWarnSeverity(Array.isArray(setting) ? setting[0] : setting);
}

function warnEntries(scope: string, rules: unknown): string[] {
    if (!isRecord(rules)) {
        return [];
    }
    return Object.entries(rules)
        .filter(([, setting]) => isWarn(setting))
        .map(([rule]) => `${scope}:${rule}`);
}

function overrideScope(override: Record<string, unknown>): string {
    const files = override.files;
    if (!Array.isArray(files) || typeof files[0] !== 'string') {
        throw new TypeError('oxlint override without a files glob');
    }
    return files[0];
}

function warnEntriesOf(config: Record<string, unknown>): string[] {
    const overrides: unknown[] = Array.isArray(config.overrides) ? config.overrides : [];
    return [
        ...warnEntries('category', config.categories),
        ...warnEntries('root', config.rules),
        ...overrides.filter(isRecord).flatMap((override) => warnEntries(overrideScope(override), override.rules)),
    ];
}

function baselineOverridesOf(config: Record<string, unknown>, rule: string): Record<string, unknown>[] {
    const overrides: unknown[] = Array.isArray(config.overrides) ? config.overrides : [];
    return overrides
        .filter(isRecord)
        .filter((override) => isRecord(override.rules) && Object.keys(override.rules).length === 1)
        .filter((override) => isRecord(override.rules) && override.rules[rule] === 'off');
}

function baselineFilesOf(override: Record<string, unknown>): string[] {
    const files = override.files;
    if (!Array.isArray(files) || !files.every((file) => typeof file === 'string')) {
        throw new TypeError('oxlint baseline override without a files list');
    }
    return files;
}

function parsedOxlintConfig(): Record<string, unknown> {
    const parsed = ts.parseConfigFileTextToJson('.oxlintrc.json', readFileSync('.oxlintrc.json', 'utf8'));
    if (parsed.error !== undefined || !isRecord(parsed.config)) {
        throw new Error('.oxlintrc.json did not parse as a JSONC object');
    }
    return parsed.config;
}

describe('.oxlintrc.json warn levels', () => {
    it('configures exactly the tracked rules at warn', () => {
        const allowed = ALLOWED_WARN_RULES.map(([entry]) => entry).sort();
        expect(warnEntriesOf(parsedOxlintConfig()).sort()).toEqual(allowed);
    });

    it.each(BASELINED_RULES)(
        'keeps one sorted, existing, literal-path burn-down baseline for %s, last in the override order',
        (rule) => {
            const config = parsedOxlintConfig();
            const baselines = baselineOverridesOf(config, rule);
            expect(baselines).toHaveLength(1);
            const [baseline] = baselines;
            const files = baselineFilesOf(baseline);
            expect(files.length).toBeGreaterThan(0);
            expect(files).toEqual([...new Set(files)].sort());
            expect(files.filter((file) => GLOB_CHARACTERS.test(file))).toEqual([]);
            expect(files.filter((file) => !existsSync(file))).toEqual([]);
            const overrides: unknown[] = Array.isArray(config.overrides) ? config.overrides : [];
            const enforcingAfter = overrides
                .slice(overrides.indexOf(baseline) + 1)
                .filter((override) => isRecord(override) && isRecord(override.rules) && rule in override.rules);
            expect(enforcingAfter).toEqual([]);
        }
    );

    it('extends no file, since an extended config can carry warn rules this pin never reads', () => {
        expect(parsedOxlintConfig().extends ?? []).toEqual([]);
    });

    it.each([
        [{ rules: { a: 1 } }, ['root:a']],
        [{ rules: { a: [1, {}] } }, ['root:a']],
        [{ rules: { a: 'warn' } }, ['root:a']],
        [{ rules: { a: ['warn'] } }, ['root:a']],
        [{ categories: { pedantic: 'warn' } }, ['category:pedantic']],
        [{ categories: { pedantic: 1 } }, ['category:pedantic']],
        [{ overrides: [{ files: ['x/**'], rules: { a: 1 } }] }, ['x/**:a']],
        [{ overrides: [{ files: ['x/**'], excludeFiles: ['y/**'], rules: { a: 1 } }] }, ['x/**:a']],
        [{ rules: { a: 'error' } }, []],
        [{ rules: { a: 2 } }, []],
        [{ rules: { a: 'off' } }, []],
        [{ rules: { a: 0 } }, []],
        [{ categories: { pedantic: 'off' } }, []],
        [{ categories: { pedantic: 'error' } }, []],
    ])('reports %j as %j', (config, expected) => {
        expect(warnEntriesOf(config)).toEqual(expected);
    });

    it('fails the lint gate on a new violation of a promoted promise rule', () => {
        const directory = mkdtempSync(resolve('.oxlint-warn-levels-'));
        const fixture = join(directory, 'promise.mjs');
        try {
            writeFileSync(fixture, 'export const value = Promise.resolve(1, 2);\n');
            const result = spawnSync(
                resolve('node_modules/.bin/oxlint'),
                ['--quiet', '--threads=2', '--format=agent', fixture],
                { cwd: process.cwd(), encoding: 'utf8' }
            );
            expect(result.status, result.stdout + result.stderr).toBe(1);
            expect(result.stdout).toContain(`${relative(process.cwd(), fixture)}:1:22: error promise(valid-params)`);
        } finally {
            unlinkSync(fixture);
            rmdirSync(directory);
        }
    });
});
