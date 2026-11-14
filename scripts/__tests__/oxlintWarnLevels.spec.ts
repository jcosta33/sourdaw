// @vitest-environment node

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { parseNativeJsonc } from '../nativeTypeScript';
import { describe, expect, it } from 'vitest';

const TRACKED_IN_6486 = 'existing violations remain; promotion or baselining tracked in #6486';

const ALLOWED_WARN_RULES: ReadonlyArray<readonly [entry: string, reason: string]> = [
    ['root:typescript/no-unnecessary-condition', TRACKED_IN_6486],
    ['root:typescript/prefer-promise-reject-errors', TRACKED_IN_6486],
    ['root:typescript/require-await', TRACKED_IN_6486],
    ['root:typescript/restrict-template-expressions', TRACKED_IN_6486],
    ['root:promise/always-return', TRACKED_IN_6486],
    ['root:jsx-a11y/click-events-have-key-events', TRACKED_IN_6486],
    ['root:jsx-a11y/label-has-associated-control', TRACKED_IN_6486],
    ['root:jsx-a11y/no-static-element-interactions', TRACKED_IN_6486],
    ['src/**/useCases/**/*.ts:func-style', TRACKED_IN_6486],
    ['**/*.spec.{ts,tsx}:typescript/no-explicit-any', TRACKED_IN_6486],
    ['**/*.spec.{ts,tsx}:typescript/no-unsafe-argument', TRACKED_IN_6486],
    ['**/*.spec.{ts,tsx}:typescript/no-unsafe-assignment', TRACKED_IN_6486],
    ['**/*.spec.{ts,tsx}:typescript/no-unsafe-call', TRACKED_IN_6486],
    ['**/*.spec.{ts,tsx}:typescript/no-unsafe-member-access', TRACKED_IN_6486],
    ['**/*.spec.{ts,tsx}:typescript/no-unsafe-return', TRACKED_IN_6486],
    ['**/*.spec.{ts,tsx}:typescript/no-floating-promises', TRACKED_IN_6486],
];

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

function parsedOxlintConfig(): Record<string, unknown> {
    const parsed = parseNativeJsonc('.oxlintrc.json', readFileSync('.oxlintrc.json', 'utf8'));
    if (!isRecord(parsed)) {
        throw new Error('.oxlintrc.json did not parse as a JSONC object');
    }
    return parsed;
}

describe('.oxlintrc.json warn levels', () => {
    it('configures exactly the tracked rules at warn', () => {
        const allowed = ALLOWED_WARN_RULES.map(([entry]) => entry).sort();
        expect(warnEntriesOf(parsedOxlintConfig()).sort()).toEqual(allowed);
    });

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
