import { existsSync, readFileSync } from 'node:fs';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const TRACKED_IN_6486 = 'existing violations remain; promotion or baselining tracked in #6486';

const ALLOWED_WARN_RULES: ReadonlyArray<readonly [entry: string, reason: string]> = [
    ['root:jsx-a11y/click-events-have-key-events', TRACKED_IN_6486],
    ['root:jsx-a11y/label-has-associated-control', TRACKED_IN_6486],
    ['root:jsx-a11y/no-static-element-interactions', TRACKED_IN_6486],
    ['**/*.spec.{ts,tsx}:typescript/no-floating-promises', TRACKED_IN_6486],
];

const TEST_FILES_GLOB = '**/*.spec.{ts,tsx}';
const IDIOMATIC_IN_TESTS = 'fires on idiomatic test code: matchers, JSON.parse and mocks are typed any';
const ASYNC_TEST_CALLBACK = 'an async test callback with no await is how Vitest is written';

const RULES_OFF_IN_TESTS: ReadonlyArray<readonly [rule: string, reason: string]> = [
    ['import/first', 'vi.mock calls are hoisted above imports by design'],
    ['jsx-a11y/click-events-have-key-events', 'test harness elements are not user controls'],
    ['jsx-a11y/no-static-element-interactions', 'test harness elements are not user controls'],
    ['typescript/no-empty-object-type', 'test fixtures declare empty prop and state shapes'],
    ['typescript/no-explicit-any', IDIOMATIC_IN_TESTS],
    ['typescript/no-unsafe-argument', IDIOMATIC_IN_TESTS],
    ['typescript/no-unsafe-assignment', IDIOMATIC_IN_TESTS],
    ['typescript/no-unsafe-call', IDIOMATIC_IN_TESTS],
    ['typescript/no-unsafe-member-access', IDIOMATIC_IN_TESTS],
    ['typescript/no-unsafe-return', IDIOMATIC_IN_TESTS],
    ['typescript/require-await', ASYNC_TEST_CALLBACK],
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
    const singleRuleOverrides = overrides
        .filter(isRecord)
        .filter((override) => isRecord(override.rules) && Object.keys(override.rules).length === 1);
    return singleRuleOverrides.filter((override) => isRecord(override.rules) && override.rules[rule] === 'off');
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

    it('switches off in test files exactly the rules named with a reason', () => {
        const config = parsedOxlintConfig();
        const overrides: unknown[] = Array.isArray(config.overrides) ? config.overrides : [];
        const testOverrides = overrides
            .filter(isRecord)
            .filter((override) => overrideScope(override) === TEST_FILES_GLOB);
        expect(testOverrides).toHaveLength(1);
        const [testOverride] = testOverrides;
        const rules = isRecord(testOverride?.rules) ? testOverride.rules : {};
        const offEntries = Object.entries(rules).filter(([, setting]) => setting === 'off' || setting === 0);
        const off = offEntries.map(([rule]) => rule).sort();
        expect(off).toEqual(RULES_OFF_IN_TESTS.map(([rule]) => rule).sort());
    });

    it.each(BASELINED_RULES)(
        'keeps one sorted, existing, literal-path burn-down baseline for %s, last in the override order',
        (rule) => {
            const config = parsedOxlintConfig();
            const baselines = baselineOverridesOf(config, rule);
            expect(baselines).toHaveLength(1);
            const [baseline] = baselines;
            if (!baseline) {
                throw new Error(`no burn-down baseline for ${rule}`);
            }
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
});
