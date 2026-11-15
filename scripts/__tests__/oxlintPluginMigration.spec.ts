import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import { clearCaches } from '@typescript-eslint/parser';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

import { buildEslintArgv, eslintEnvironment } from '../runLint.ts';

import { configuredSourdawRules } from './helpers/configuredSourdawRules.ts';
import { lintMigratedRules, runProductionLint, withLintFixture } from './helpers/lintMigratedRules.ts';
import { typeQueryLintFixtures } from './helpers/typeQueryLintFixtures.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const cases = [
    ...typeQueryLintFixtures,
    {
        rule: 'sourdaw/no-foreign-store-write',
        filename: 'src/modules/Example/useCases/example.ts',
        invalid:
            "import { transportStore } from '#/modules/Transport/stores'; const alias = transportStore; alias.set({});",
        valid: "import { transportStore } from '#/modules/Transport/stores'; transportStore.get(); function apply(transportStore: { set(): void }) { transportStore.set(); }",
    },
    {
        rule: 'sourdaw/no-model-layer-upward-import',
        filename: 'src/modules/Example/models/Example.ts',
        invalid: "import { apply } from '../useCases/apply';",
        valid: "import { value } from './value';",
    },
    {
        rule: 'sourdaw/no-repository-usecase-import',
        filename: 'src/modules/Example/repositories/example.ts',
        invalid: "export const value = import('#/modules/Other/useCases');",
        valid: "export const value = import('#/modules/Other/events');",
    },
    {
        rule: 'sourdaw/no-usecase-repository-reexport',
        filename: 'src/modules/Example/useCases/example.ts',
        invalid: "export { read } from '../repositories/read';",
        valid: "import { read } from '../repositories/read'; export function apply() { return read(); }",
    },
    {
        rule: 'sourdaw/no-nonmodule-private-module-import',
        filename: 'src/app/example.ts',
        invalid: "import { value } from '#/modules/Other/models/value';",
        valid: "import { value } from '#/modules/Other/useCases';",
    },
    {
        rule: 'sourdaw/no-react-import-outside-ui',
        filename: 'src/app/example.ts',
        invalid: "import { useState } from 'react';",
        valid: 'export const value = 1;',
    },
    {
        rule: 'sourdaw/no-react-in-domain-logic',
        filename: 'src/modules/Example/useCases/example.ts',
        invalid: "import { useState } from 'react';",
        valid: 'export const value = 1;',
    },
    {
        rule: 'sourdaw/no-manual-memoization',
        filename: 'src/modules/Example/presentations/components/Example.tsx',
        invalid: "import { memo as wrap } from 'react'; export const Example = wrap(() => <div />);",
        valid: 'function wrap(component: () => unknown) { return component; } export const Example = wrap(() => <div />);',
    },
    {
        rule: 'sourdaw/no-namespace-import',
        filename: 'src/modules/Example/useCases/example.ts',
        invalid: "import * as library from 'library';",
        valid: "import * as z from 'zod';",
    },
    {
        rule: '@eslint-react/no-use-context',
        filename: 'src/modules/Example/presentations/components/Example.tsx',
        invalid:
            "import { createContext, useContext } from 'react'; const Context = createContext(1); export function Example() { return <div>{useContext(Context)}</div>; }",
        valid: "import { createContext, use } from 'react'; const Context = createContext(1); export function Example() { return <div>{use(Context)}</div>; }",
    },
    {
        rule: '@eslint-react/web-api-no-leaked-interval',
        filename: 'src/modules/Example/presentations/components/Example.tsx',
        invalid:
            "import { useEffect } from 'react'; export function Example() { useEffect(() => { setInterval(() => console.log('tick'), 1000); }, []); return <div />; }",
        valid: "import { useEffect } from 'react'; export function Example() { useEffect(() => { const timer = setInterval(() => console.log('tick'), 1000); return () => clearInterval(timer); }, []); return <div />; }",
    },
    {
        rule: '@eslint-react/dom-no-unsafe-iframe-sandbox',
        filename: 'src/app/Example.tsx',
        invalid: 'export const Example = () => <iframe sandbox="allow-scripts allow-same-origin" />;',
        valid: 'export const Example = () => <iframe sandbox="allow-scripts" />;',
    },
    {
        rule: '@eslint-react/jsx-no-comment-textnodes',
        filename: 'src/app/Example.tsx',
        invalid: 'export const Example = () => <div>// comment</div>;',
        valid: 'export const Example = () => <div>{/* comment */}</div>;',
    },
    {
        rule: 'react-hooks-js/rules-of-hooks',
        filename: 'src/app/Example.tsx',
        invalid:
            "import { useState } from 'react'; export function useExample(ready: boolean) { if (ready) { useState(0); } }",
        valid: "import { useState } from 'react'; export function useExample() { return useState(0); }",
    },
    {
        rule: 'react-hooks-js/purity',
        filename: 'src/app/Example.tsx',
        invalid: 'export function Example() { return <div>{Date.now()}</div>; }',
        valid: 'export function Example({ timestamp }: { timestamp: number }) { return <div>{timestamp}</div>; }',
    },
    {
        rule: 'react-hooks-js/immutability',
        filename: 'src/app/Example.tsx',
        invalid:
            'export function Example({ value }: { value: { count: number } }) { value.count = 1; return <div>{value.count}</div>; }',
        valid: 'export function Example({ value }: { value: { count: number } }) { return <div>{value.count + 1}</div>; }',
    },
    {
        rule: '@tanstack/query/exhaustive-deps',
        filename: 'src/app/query.ts',
        invalid:
            "import { useQuery } from '@tanstack/react-query'; export function useExample(identifier: string) { return useQuery({ queryKey: ['item'], queryFn: () => fetch(identifier) }); }",
        valid: "import { useQuery } from '@tanstack/react-query'; export function useExample(identifier: string) { return useQuery({ queryKey: ['item', identifier], queryFn: () => fetch(identifier) }); }",
    },
    {
        rule: '@tanstack/query/stable-query-client',
        filename: 'src/app/Example.tsx',
        invalid:
            "import { QueryClient } from '@tanstack/react-query'; export function Example() { const client = new QueryClient(); return <div>{String(client)}</div>; }",
        valid: "import { QueryClient } from '@tanstack/react-query'; const client = new QueryClient(); export function Example() { return <div>{String(client)}</div>; }",
    },
    {
        rule: '@tanstack/query/no-unstable-deps',
        filename: 'src/app/Example.tsx',
        invalid:
            "import { useEffect } from 'react'; import { useQuery } from '@tanstack/react-query'; export function useExample() { const query = useQuery({ queryKey: ['item'], queryFn: () => Promise.resolve(1) }); useEffect(() => console.log(query.data), [query]); }",
        valid: "import { useEffect } from 'react'; import { useQuery } from '@tanstack/react-query'; export function useExample() { const { data } = useQuery({ queryKey: ['item'], queryFn: () => Promise.resolve(1) }); useEffect(() => console.log(data), [data]); }",
    },
    {
        rule: '@tanstack/query/infinite-query-property-order',
        filename: 'src/app/query.ts',
        invalid:
            "import { useInfiniteQuery } from '@tanstack/react-query'; useInfiniteQuery({ queryKey: ['item'], getNextPageParam: () => undefined, queryFn: () => Promise.resolve(1), initialPageParam: 0 });",
        valid: "import { useInfiniteQuery } from '@tanstack/react-query'; useInfiniteQuery({ queryKey: ['item'], queryFn: () => Promise.resolve(1), getNextPageParam: () => undefined, initialPageParam: 0 });",
    },
    {
        rule: '@tanstack/query/mutation-property-order',
        filename: 'src/app/query.ts',
        invalid:
            "import { useMutation } from '@tanstack/react-query'; useMutation({ mutationFn: () => Promise.resolve(1), onSettled: () => undefined, onMutate: () => undefined });",
        valid: "import { useMutation } from '@tanstack/react-query'; useMutation({ mutationFn: () => Promise.resolve(1), onMutate: () => undefined, onSettled: () => undefined });",
    },
    {
        rule: '@stylistic/spaced-comment',
        filename: 'src/app/example.ts',
        invalid: '//comment\nexport const value = 1;',
        valid: '/// reference marker\n// # exception\n/* balanced */\nexport const value = 1;',
    },
    {
        rule: 'promise-js/no-return-wrap',
        filename: 'src/app/example.ts',
        invalid: 'task.then(value => Promise.resolve(value));',
        valid: 'values.map(value => Promise.resolve(value));',
    },
    {
        rule: 'jsx-a11y-x-js/interactive-supports-focus',
        filename: 'src/app/Example.tsx',
        invalid: 'export const Example = () => <div role="button" onClick={() => undefined} />;',
        valid: 'export const Example = () => <div role="button" tabIndex={0} onClick={() => undefined} />;',
    },
] as const;

// Keep real lint processes and their temporary workspace files in this one
// sequential suite. A native TS program can enumerate another worker's fixture
// before that worker deletes it, then fail when opening the missing file.
describe('production Oxlint public-plugin migration', () => {
    it.each([false, true])(
        'enforces retained bulk suppression budgets through the production ESLint CLI (fix=%s)',
        (fix) => {
            const rule = '@eslint-react/no-array-index-key';
            const oneViolation =
                'export function Example() {\n    return [1].map((value, index) => <div key={index}>{value}</div>);\n}\n';
            const twoViolations =
                'export function Example() {\n    return [1].map((value, index) => <div key={index}><span key={index}>{value}</span></div>);\n}\n';
            const noViolation =
                'export function Example() {\n    return [1].map((value) => <div key={value}>{value}</div>);\n}\n';
            withLintFixture(oneViolation, 'src/app/Example.tsx', (fixture) => {
                const directory = mkdtempSync(join(tmpdir(), 'lint-migration-suppressions-'));
                const suppressionsFile = join(directory, 'eslint-suppressions.json');
                const budget = JSON.stringify({ [relative(process.cwd(), fixture)]: { [rule]: { count: 1 } } });
                const run = (text: string, target = fixture) => {
                    writeFileSync(target, text);
                    const argv = buildEslintArgv({ fix, full: false }, [target]);
                    const location = argv.indexOf('--suppressions-location');
                    expect(location).toBeGreaterThan(0);
                    expect(argv[location + 1]).toBe('eslint-suppressions.json');
                    expect(argv).not.toContain('--pass-on-unpruned-suppressions');
                    argv[location + 1] = suppressionsFile;
                    const result = spawnSync('pnpm', argv, {
                        cwd: process.cwd(),
                        encoding: 'utf8',
                        timeout: 120_000,
                        env: eslintEnvironment(process.env, fix),
                    });
                    expect(result.error).toBeUndefined();
                    expect(readFileSync(suppressionsFile, 'utf8')).toBe(budget);
                    return { status: result.status, output: result.stdout + result.stderr };
                };
                try {
                    writeFileSync(suppressionsFile, budget);
                    const accepted = run(oneViolation);
                    expect(accepted.status, accepted.output).toBe(0);
                    const excess = run(twoViolations);
                    expect(excess.status, excess.output).toBe(1);
                    expect(excess.output).toContain(rule);
                    const unused = run(noViolation);
                    expect(unused.status, unused.output).toBe(2);
                    expect(unused.output).toContain('suppression');
                    const unrecorded = withLintFixture(oneViolation, 'src/app/Unrecorded.tsx', (target) =>
                        run(oneViolation, target)
                    );
                    expect(unrecorded.status, unrecorded.output).toBe(1);
                    expect(unrecorded.output).toContain(rule);
                } finally {
                    rmSync(directory, { recursive: true, force: true });
                }
            });
        },
        180_000
    );

    it.each(cases)(
        'preserves $rule invalid and valid behavior',
        ({ rule, filename, invalid, valid }) => {
            const rejected = lintMigratedRules(invalid, filename);
            expect(
                rejected.messages.filter((message) => message.ruleId === rule),
                rejected.output
            ).not.toEqual([]);
            expect(rejected.status).toBe(1);
            const accepted = lintMigratedRules(valid, filename);
            expect(
                accepted.messages.filter((message) => message.ruleId === rule),
                accepted.output
            ).toEqual([]);
        },
        60_000
    );

    it.each([
        ['sourdaw/no-enum', 'enum Fruit { Apple }'],
        ['promise-js/no-return-wrap', 'task.then(value => Promise.resolve(value));'],
        [
            'jsx-a11y-x-js/interactive-supports-focus',
            'export const Example = () => <div role="button" onClick={() => undefined} />;',
        ],
        ['react-hooks-js/purity', 'export function Example() { return <div>{Date.now()}</div>; }'],
    ])(
        'honors explicit inline suppression for %s',
        (rule, code) => {
            const filename =
                rule.includes('purity') || rule.includes('focus') ? 'src/app/Example.tsx' : 'src/app/example.ts';
            expect(lintMigratedRules(code, filename).messages.some((message) => message.ruleId === rule)).toBe(true);
            const suppressed = lintMigratedRules(`// eslint-disable-next-line ${rule}\n${code}`, filename);
            expect(
                suppressed.messages.filter((message) => message.ruleId === rule),
                suppressed.output
            ).toEqual([]);
        },
        60_000
    );

    it.each([false, true])(
        'accepts inactive legacy plugin directives (fix=%s)',
        (fix) => {
            const input =
                '// eslint-disable-next-line react-hooks/rules-of-hooks, promise/no-return-wrap, jsx-a11y-x/no-noninteractive-tabindex -- Preserve inactive legacy directives.\n' +
                'export const value = 1;\n';
            const result = runProductionLint(input, 'scripts/example.mjs', fix);
            expect(result.status, result.output).toBe(0);
            expect(result.text).toBe(input);
            expect(result.output).toContain('lint: eslint passed');
            expect(result.output).toContain('lint: oxlint-plugins passed');
        },
        180_000
    );

    it.each([false, true])(
        'rejects unknown legacy plugin rule directives (fix=%s)',
        (fix) => {
            const input =
                '// eslint-disable-next-line react-hooks/not-a-real-rule -- Unknown rules must remain errors.\n' +
                'export const value = 1;\n';
            const result = runProductionLint(input, 'scripts/example.mjs', fix);
            expect(result.status, result.output).toBe(1);
            expect(result.output).toContain("Definition for rule 'react-hooks/not-a-real-rule' was not found");
            expect(result.output).toContain('lint: eslint failed');
        },
        180_000
    );

    it.each([
        'scripts/example.mjs',
        'scripts/example.cjs',
        'src/app/example.mts',
        'src/app/example.cts',
        'tests/e2e/example.ts',
        'server/example.ts',
    ])(
        'keeps Prettier diagnostics and fixes on %s',
        (filename) => {
            const input = filename.endsWith('.cjs') ? 'module.exports={value:1}' : 'export const value=1';
            const expected = filename.endsWith('.cjs')
                ? 'module.exports = { value: 1 };\n'
                : 'export const value = 1;\n';
            const rejected = runProductionLint(input, filename);
            expect(rejected.status, rejected.output).toBe(1);
            expect(rejected.output).toContain('prettier/prettier');
            const fixed = runProductionLint(input, filename, true);
            expect(fixed.text).toBe(expected);
            expect(fixed.status, fixed.output).toBe(0);
        },
        180_000
    );

    it('keeps JSX-only custom effects and test exemptions exact', () => {
        const code = 'useEffect(() => { setValue(value); }, [value]);';
        const rule = 'sourdaw/no-useeffect-derived-state';
        expect(
            lintMigratedRules(code, 'src/modules/Example/presentations/hooks/useExample.tsx').messages.some(
                (message) => message.ruleId === rule
            )
        ).toBe(true);
        expect(
            lintMigratedRules(code, 'src/modules/Example/presentations/hooks/useExample.ts').messages.filter(
                (message) => message.ruleId === rule
            )
        ).toEqual([]);
        expect(
            lintMigratedRules(code, 'src/modules/Example/presentations/hooks/useExample.spec.tsx').messages.filter(
                (message) => message.ruleId === rule
            )
        ).toEqual([]);
    }, 60_000);

    it('checks the final formatted size during automatic fixes', () => {
        const values = Array.from({ length: 110 }, (_, index) => `'long-value-${index}'`).join(',');
        const input = `export function expand() { const values = [${values}]; return values; }\n`;
        expect(input.split('\n')).toHaveLength(2);
        const result = runProductionLint(input, 'scripts/example.ts', true);
        expect(result.text.split('\n').length).toBeGreaterThan(100);
        expect(result.status, result.output).toBe(1);
        expect(result.output).toContain('max-lines-per-function');
    }, 180_000);

    it('rejects hook violations exposed when formatting moves them beyond a next-line suppression', () => {
        const input =
            "import { useState } from 'react';\n\n" +
            '// eslint-disable-next-line react-hooks-js/rules-of-hooks, @eslint-react/rules-of-hooks -- Controlled suppression scope probe.\n' +
            'export function useExample(ready: boolean) { if (ready) { useState(0); } }\n';
        const filename = 'src/modules/Example/presentations/hooks/useExample.tsx';
        const fixed = runProductionLint(input, filename, true);
        expect(fixed.text).toContain('    if (ready) {\n        useState(0);\n    }');
        const checked = runProductionLint(fixed.text, filename);
        for (const result of [fixed, checked]) {
            expect(result.status, result.output).toBe(1);
            expect(result.output).toMatch(/@eslint-react(?:\/|\()rules-of-hooks/);
            expect(result.output).toMatch(/react-hooks-js(?:\/|\()rules-of-hooks/);
        }
    }, 180_000);

    it('fixes comment violations exposed when formatting moves them beyond a next-line suppression', () => {
        const input =
            '// eslint-disable-next-line @stylistic/spaced-comment -- Controlled suppression scope probe.\n' +
            'export function example() { /*comment*/ return 1; }\n';
        const filename = 'src/modules/Example/presentations/hooks/useExample.tsx';
        const fixed = runProductionLint(input, filename, true);
        expect(fixed.status, fixed.output).toBe(0);
        expect(fixed.text).toBe(
            '// eslint-disable-next-line @stylistic/spaced-comment -- Controlled suppression scope probe.\n' +
                'export function example() {\n    /* comment */ return 1;\n}\n'
        );
        const checked = runProductionLint(fixed.text, filename);
        expect(checked.status, checked.output).toBe(0);
    }, 180_000);

    it('keeps migrated comment fixes and suppression valid after final formatting', () => {
        const input = '//comment\n// eslint-disable-next-line sourdaw/no-enum\nexport enum Fruit{Apple}\n';
        const fixed = runProductionLint(input, 'scripts/example.ts', true);
        expect(fixed.status, fixed.output).toBe(0);
        expect(fixed.text).toBe(
            '// comment\n// eslint-disable-next-line sourdaw/no-enum\nexport enum Fruit {\n    Apple,\n}\n'
        );
        const verified = runProductionLint(fixed.text, 'scripts/example.ts');
        expect(verified.status, verified.output).toBe(0);
    }, 180_000);

    it('runs migrated rules in Oxlint and retains service gaps, bulk budgets and core rules in ESLint', async () => {
        const eslint = new ESLint();
        const config = await eslint.calculateConfigForFile(resolve('src/app/App.tsx'));
        if (!config) {
            throw new Error('ESLint did not load the app configuration');
        }
        const active = Object.entries(config.rules)
            .filter(([, setting]) => {
                if (!Array.isArray(setting) || typeof setting[0] !== 'number') {
                    throw new TypeError('ESLint resolved a rule without a normalized severity');
                }
                return setting[0] !== 0;
            })
            .map(([name]) => name);
        expect(active.sort()).toEqual(
            [
                '@eslint-react/exhaustive-deps',
                '@eslint-react/naming-convention-context-name',
                '@eslint-react/naming-convention-ref-name',
                '@eslint-react/no-array-index-key',
                '@eslint-react/set-state-in-effect',
                '@eslint-react/use-state',
                'react-hooks/exhaustive-deps',
                'react-hooks/refs',
                'react-hooks/set-state-in-effect',
                '@eslint-react/no-leaked-conditional-rendering',
                '@eslint-community/eslint-comments/disable-enable-pair',
                '@eslint-community/eslint-comments/no-aggregating-enable',
                '@eslint-community/eslint-comments/no-duplicate-disable',
                '@eslint-community/eslint-comments/no-unlimited-disable',
                '@eslint-community/eslint-comments/no-unused-enable',
                '@tanstack/query/no-rest-destructuring',
                '@tanstack/query/no-void-query-fn',
                '@typescript-eslint/naming-convention',
                'complexity',
                'consistent-return',
                'id-length',
                'import-x/order',
                'max-depth',
                'max-lines',
                'max-lines-per-function',
                'no-invalid-this',
                'no-octal',
                'no-restricted-syntax',
                'no-useless-computed-key',
                'no-void',
                'preserve-caught-error',
                'prettier/prettier',
            ].sort()
        );
        const plugins = readFileSync('.oxlint-plugins.json', 'utf8');
        expect(plugins).not.toContain('no-leaked-conditional-rendering');
        expect(plugins).not.toContain('no-void-query-fn');
        expect(plugins).not.toContain('no-rest-destructuring');
    });

    it('reuses canonical moved settings in cofix mode without changing retained or parser scopes', () => {
        const targets: Array<'app' | 'spec' | 'script' | 'tool' | 'server' | 'e2e' | 'declaration'> = [
            'app',
            'spec',
            'script',
            'tool',
            'server',
            'e2e',
            'declaration',
        ];
        const query = `
            import { ESLint } from 'eslint';
            const eslint = new ESLint();
            const targets = {
                app: 'src/app/App.tsx',
                spec: 'src/app/__tests__/App.spec.tsx',
                script: 'scripts/runLint.ts',
                tool: 'scripts/example.mjs',
                server: 'server/example.ts',
                e2e: 'tests/e2e/example.ts',
                declaration: 'src/app/example.d.ts',
            };
            const result = {};
            for (const [name, filename] of Object.entries(targets)) {
                const config = await eslint.calculateConfigForFile(filename);
                if (!config) throw new Error('Missing config for ' + filename);
                result[name] = {
                    rules: config.rules,
                    project: config.languageOptions.parserOptions.project,
                    react: config.settings['react-x'],
                    legacy: Object.keys(config.plugins).filter(name =>
                        ['jsx-a11y-x', 'promise', 'react-hooks'].includes(name)
                    ).sort(),
                };
            }
            console.log(JSON.stringify(result));
        `;
        const inspect = (fix: boolean) => {
            const result = spawnSync(process.execPath, ['--input-type=module', '-e', query], {
                cwd: process.cwd(),
                encoding: 'utf8',
                timeout: 60_000,
                env: eslintEnvironment(process.env, fix),
            });
            expect(result.status, result.stdout + result.stderr).toBe(0);
            const configs: unknown = JSON.parse(result.stdout);
            if (!isRecord(configs)) {
                throw new TypeError('ESLint did not return configuration snapshots');
            }
            if (
                Object.keys(configs).length !== targets.length ||
                targets.some((target) => !Object.hasOwn(configs, target))
            ) {
                throw new TypeError('ESLint did not return exactly the required configuration snapshot targets');
            }
            const snapshot = (target: string) => {
                const config = configs[target];
                if (!isRecord(config) || !isRecord(config.rules)) {
                    throw new TypeError(`ESLint returned an invalid configuration snapshot for ${target}`);
                }
                return {
                    rules: config.rules,
                    project: config.project,
                    react: config.react,
                    legacy: config.legacy,
                };
            };
            return {
                app: snapshot('app'),
                spec: snapshot('spec'),
                script: snapshot('script'),
                tool: snapshot('tool'),
                server: snapshot('server'),
                e2e: snapshot('e2e'),
                declaration: snapshot('declaration'),
            };
        };
        const check = inspect(false);
        const fix = inspect(true);
        const canonical: unknown = JSON.parse(readFileSync('.oxlint-plugins.json', 'utf8'));
        if (!isRecord(canonical) || !isRecord(canonical.settings) || !Array.isArray(canonical.overrides)) {
            throw new TypeError('The canonical plugin configuration is incomplete');
        }
        const stylistic = canonical.overrides.find(
            (entry: unknown) =>
                isRecord(entry) && isRecord(entry.rules) && entry.rules['@stylistic/spaced-comment'] !== undefined
        );
        if (!isRecord(stylistic) || !isRecord(stylistic.rules)) {
            throw new TypeError('The canonical plugin configuration has no comment rule');
        }
        const commentSetting = stylistic.rules['@stylistic/spaced-comment'];
        if (!Array.isArray(commentSetting)) {
            throw new TypeError('The canonical comment rule has no options');
        }
        for (const target of targets) {
            for (const mode of [check, fix]) {
                expect(mode[target].legacy, target).toEqual(['jsx-a11y-x', 'promise', 'react-hooks']);
                for (const rule of [
                    '@eslint-react/exhaustive-deps',
                    '@eslint-react/naming-convention-context-name',
                    '@eslint-react/naming-convention-ref-name',
                    '@eslint-react/no-array-index-key',
                    '@eslint-react/set-state-in-effect',
                    '@eslint-react/use-state',
                    'react-hooks/exhaustive-deps',
                    'react-hooks/refs',
                    'react-hooks/set-state-in-effect',
                ]) {
                    const expected = rule === '@eslint-react/use-state' ? [2, {}] : [2];
                    expect(mode[target].rules[rule], `${target}: ${rule}`).toEqual(expected);
                }
                const legacyActive = Object.entries(mode[target].rules).filter(([name, setting]) => {
                    if (!/^(jsx-a11y-x|promise|react-hooks)\//.test(name)) {
                        return false;
                    }
                    if (!Array.isArray(setting)) {
                        throw new TypeError(`ESLint returned no normalized severity for ${name}`);
                    }
                    return setting[0] !== 0;
                });
                expect(legacyActive.map(([name]) => name).sort(), target).toEqual([
                    'react-hooks/exhaustive-deps',
                    'react-hooks/refs',
                    'react-hooks/set-state-in-effect',
                ]);
            }
            expect(fix[target].react, target).toEqual(canonical.settings['react-x']);
            expect(fix[target].project, target).toEqual(check[target].project);
            for (const rule of [
                '@eslint-react/no-leaked-conditional-rendering',
                '@tanstack/query/no-rest-destructuring',
                '@tanstack/query/no-void-query-fn',
                '@typescript-eslint/naming-convention',
                'import-x/order',
                'max-lines',
                'prettier/prettier',
            ]) {
                expect(fix[target].rules[rule], `${target}: ${rule}`).toEqual(check[target].rules[rule]);
            }
            if (target === 'tool') {
                expect(fix[target].rules['@stylistic/spaced-comment'], target).toBeUndefined();
            } else {
                expect(fix[target].rules['@stylistic/spaced-comment'], target).toEqual([2, ...commentSetting.slice(1)]);
            }
            expect(check[target].rules['@stylistic/spaced-comment']).toBeUndefined();
        }
        expect(fix.app.rules['sourdaw/no-type-assertion-escape']).toEqual([2]);
        expect(fix.spec.rules['sourdaw/no-type-assertion-escape']).toEqual([0]);
        expect(fix.tool.rules['sourdaw/no-enum']).toBeUndefined();
        expect(fix.tool.rules['@eslint-react/no-leaked-conditional-rendering']).toEqual([0]);
        const naming = fix.tool.rules['@typescript-eslint/naming-convention'];
        if (!Array.isArray(naming)) {
            throw new TypeError('ESLint returned no naming-convention setting for JavaScript tooling');
        }
        expect(naming[0]).toBe(0);
        expect(fix.app.rules['react-hooks-js/purity']).toEqual([2]);
        expect(fix.app.rules['react-hooks-js/refs']).toBeUndefined();
        expect(fix.app.rules['react-hooks/refs']).toEqual([2]);
        expect(fix.server.project).toBe('./server/tsconfig.json');
        expect(fix.e2e.project).toBe('./tsconfig.e2e.json');
        expect(fix.tool.project).toBe(false);
    }, 130_000);

    it.each(['eslint.config.mjs', 'scripts/lint/sourdaw.mjs'])(
        'runs both lint engines on %s',
        (target) => {
            const result = spawnSync(process.execPath, ['scripts/runLint.ts', target], {
                cwd: process.cwd(),
                encoding: 'utf8',
                env: { ...process.env, npm_config_verify_deps_before_run: 'false' },
                timeout: 120_000,
            });

            expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
            expect(result.stdout).toMatch(/lint: oxlint passed/);
            expect(result.stdout).toMatch(/lint: oxlint-plugins passed/);
            expect(result.stdout).toMatch(/lint: eslint passed/);
        },
        130_000
    );

    it('rejects default exports outside the required root config', () => {
        const directory = mkdtempSync(resolve('.eslint-config-regression-'));
        const ordinary = `${directory}.mjs`;
        const nestedConfig = join(directory, 'eslint.config.mjs');
        try {
            writeFileSync(ordinary, 'export default 1;\n');
            writeFileSync(nestedConfig, 'export default 1;\n');
            const result = spawnSync(
                resolve('node_modules/.bin/oxlint'),
                ['--quiet', '--threads=2', '--format=agent', ordinary, nestedConfig],
                { cwd: process.cwd(), encoding: 'utf8' }
            );
            expect(result.status, result.stderr).toBe(1);
            expect(result.stdout).toContain(
                `${relative(process.cwd(), ordinary)}:1:8: error import(no-default-export)`
            );
            expect(result.stdout).toContain(
                `${relative(process.cwd(), nestedConfig)}:1:8: error import(no-default-export)`
            );
        } finally {
            unlinkSync(ordinary);
            unlinkSync(nestedConfig);
            rmdirSync(directory);
        }
    });

    it.each([false, true])(
        'rejects missing, unmatched, unsupported and partially missing targets (fix=%s)',
        (fix) => {
            const directory = mkdtempSync(resolve('scripts/lint-targets-'));
            const valid = join(directory, 'valid.ts');
            const missing = join(directory, 'missing.ts');
            const unsupported = join(directory, 'example.rs');
            try {
                writeFileSync(valid, 'export const value = 1;\n');
                writeFileSync(unsupported, 'fn main() {}\n');
                for (const targets of [
                    [missing],
                    [join(directory, 'absent/**/*.ts')],
                    [unsupported],
                    [valid, missing],
                ]) {
                    const args = ['scripts/runLint.ts'];
                    if (fix) {
                        args.push('--fix');
                    }
                    args.push(...targets);
                    const result = spawnSync(process.execPath, args, {
                        cwd: process.cwd(),
                        encoding: 'utf8',
                        timeout: 120_000,
                        env: { ...process.env, npm_config_verify_deps_before_run: 'false' },
                    });
                    expect(result.status, result.stdout + result.stderr).toBe(1);
                }
            } finally {
                unlinkSync(valid);
                unlinkSync(unsupported);
                rmdirSync(directory);
            }
        },
        180_000
    );

    it('validates CommonJS parser admission after ESLint finishes fixing', () => {
        const invalid = runProductionLint('export const value = 1;\n', 'scripts/example.cjs', true);
        expect(invalid.status, invalid.output).toBe(1);
        expect(invalid.output).toContain('lint: eslint passed');
        expect(invalid.output).toMatch(/lint: eslint passed[^]*lint: oxlint-plugins started/);
        expect(invalid.output).toContain('lint: oxlint-plugins failed');
        const valid = runProductionLint('module.exports = { value: 1 };\n', 'scripts/example.cjs', true);
        expect(valid.status, valid.output).toBe(0);
        expect(valid.output).toMatch(/lint: eslint passed[^]*lint: oxlint-plugins passed/);
        expect(valid.text).toBe('module.exports = { value: 1 };\n');
    }, 180_000);

    it('applies the production Oxlint custom rules to invalid and valid TypeScript', () => {
        expect(lintMigratedRules('enum Fruit { Apple }\n').messages.map((message) => message.ruleId)).toContain(
            'sourdaw/no-enum'
        );
        expect(
            lintMigratedRules('const fruit = { Apple: 1 } as const;\n').messages.map((message) => message.ruleId)
        ).not.toContain('sourdaw/no-enum');
    }, 60_000);

    it('rejects a migrated violation in the production runner and accepts its valid replacement', () => {
        const directory = mkdtempSync(resolve('scripts/lint-route-'));
        const fixture = join(directory, 'example.ts');
        const run = () =>
            spawnSync(process.execPath, ['scripts/runLint.ts', fixture], {
                cwd: process.cwd(),
                encoding: 'utf8',
                timeout: 120_000,
                env: { ...process.env, npm_config_verify_deps_before_run: 'false' },
            });
        try {
            writeFileSync(fixture, 'export enum Fruit {\n    Apple,\n}\n');
            const rejected = run();
            expect(rejected.status, rejected.stdout + rejected.stderr).toBe(1);
            expect(rejected.stdout).toContain('lint: oxlint passed');
            expect(rejected.stdout).toContain('error sourdaw(no-enum)');
            expect(rejected.stdout).toContain('lint: oxlint-plugins failed');
            expect(rejected.stdout).not.toContain('lint: eslint started');
            writeFileSync(fixture, 'export const fruit = { Apple: 1 } as const;\n');
            const accepted = run();
            expect(accepted.status, accepted.stdout + accepted.stderr).toBe(0);
            expect(accepted.stdout).toContain('lint: oxlint-plugins passed');
            expect(accepted.stdout).toContain('lint: eslint passed');
        } finally {
            unlinkSync(fixture);
            rmdirSync(directory);
        }
    }, 180_000);

    it('reports every assertion escape and no ordinary assertion', async () => {
        const rules = await configuredSourdawRules();
        const messages = rules['no-type-assertion-escape']?.meta?.messages;
        if (!messages) {
            throw new Error('The assertion-escape rule did not declare its diagnostic messages');
        }
        const lint = (code: string, _ruleEntry: unknown) =>
            lintMigratedRules(code, 'src/modules/Example/useCases/example.ts')
                .messages.filter((message) => message.ruleId === 'sourdaw/no-type-assertion-escape')
                .map((message) => Object.entries(messages).find(([, text]) => text === message.message)?.[0]);
        const migration = JSON.parse(readFileSync('.oxlint-plugins.json', 'utf8'));
        const production = migration.overrides.find(
            (entry: { files: string[] }) => entry.files[0] === '**/*.{ts,tsx,mts,cts}'
        ).rules['sourdaw/no-type-assertion-escape'];
        const assertionScopes = migration.overrides
            .filter(
                (entry: { rules?: Record<string, unknown> }) =>
                    entry.rules?.['sourdaw/no-type-assertion-escape'] !== undefined
            )
            .map((entry: { files: string[]; rules: Record<string, unknown> }) => [
                entry.files,
                entry.rules['sourdaw/no-type-assertion-escape'],
            ]);
        expect(assertionScopes).toEqual([
            [['**/*.{ts,tsx,mts,cts}'], 'error'],
            [
                [
                    '**/*.spec.{ts,tsx}',
                    '**/*.test.{ts,tsx}',
                    '**/setupTests.ts',
                    '**/*.mock.ts',
                    '**/__tests__/**/*.{ts,tsx}',
                    'src/**/testing/**/*.{ts,tsx}',
                ],
                'off',
            ],
        ]);

        expect(production).toBe('error');
        expect(lint('const value = input as never;', production)).toEqual(['noAsNever']);
        expect(lint('const value = input as any;', production)).toEqual(['noAsAny']);
        expect(lint('const value = input as unknown as Thing;', production)).toEqual(['noAsUnknownAs']);
        expect(lint('const value = [1, 2] as const;', production)).toEqual([]);
        expect(lint('const value = input as Thing;', production)).toEqual([]);
        expect(lint('const value = input as unknown;', production)).toEqual([]);

        expect(lint('const value = <never>input;', production)).toEqual(['noAsNever']);
        expect(lint('const value = <any>input;', production)).toEqual(['noAsAny']);
        expect(lint('const value = <Thing>(<unknown>input);', production)).toEqual(['noAsUnknownAs']);
        expect(lint('const value = <Thing>(input as unknown);', production)).toEqual(['noAsUnknownAs']);
        expect(lint('const value = (<unknown>input) as Thing;', production)).toEqual(['noAsUnknownAs']);
        expect(lint('const value = <Thing>input;', production)).toEqual([]);
        expect(lint('const value = <unknown>input;', production)).toEqual([]);

        expect(lint('const value = (input as unknown)! as Thing;', production)).toEqual(['noAsUnknownAs']);
        expect(lint('const value = (input as unknown satisfies unknown) as Thing;', production)).toEqual([
            'noAsUnknownAs',
        ]);
        expect(lint('const value = <Thing>(<unknown>input)!;', production)).toEqual(['noAsUnknownAs']);
        expect(lint('const value = <Thing>(<unknown>input satisfies unknown);', production)).toEqual(['noAsUnknownAs']);
        expect(lint('const value = input!;', production)).toEqual([]);
        expect(lint('const value = (input as Thing)!;', production)).toEqual([]);
        expect(lint('const value = (input as Thing)! as Other;', production)).toEqual([]);

        const restoreHandler = lintMigratedRules(
            'const value = input as never;',
            'src/modules/Example/handlers/restore/handleRestoreTrack.ts'
        );
        expect(
            restoreHandler.messages
                .filter((message) => message.ruleId === 'sourdaw/no-type-assertion-escape')
                .map((message) => message.message)
        ).toEqual([messages.noAsNever]);
    }, 180_000);

    it('preserves custom rule diagnostics through the loaded plugin', async () => {
        const rules = await configuredSourdawRules();
        const cases = [
            {
                rule: 'no-useeffect-fetching',
                messageId: 'noUseEffectFetching',
                filename: 'src/modules/Example/presentations/hooks/useExample.tsx',
                invalid: 'useEffect(() => { if (ready) { fetch(url); } }, []);',
                valid: 'useEffect(() => { if (ready) { updateView(); } }, []);',
            },
            {
                rule: 'no-useeffect-derived-state',
                messageId: 'noDerivedStateEffect',
                filename: 'src/modules/Example/presentations/hooks/useExample.tsx',
                invalid: 'React.useLayoutEffect(() => { if (ready) { setValue(value); } }, [value]);',
                valid: 'React.useLayoutEffect(() => { if (ready) { setValue(fetch(url)); } }, [value]);',
            },
            {
                rule: 'no-useeffect-derived-state',
                messageId: 'noDerivedStateEffect',
                filename: 'src/modules/Example/presentations/hooks/useExample.tsx',
                invalid: 'useEffect(() => { setActiveDevice(id); }, [id]);',
                valid: 'useEffect(() => { setActiveDevice(id); return () => setActiveDevice(null); }, [id]);',
            },
            {
                rule: 'no-multiple-function-exports',
                messageId: 'noMultipleFunctionExports',
                filename: 'src/modules/Example/useCases/example.ts',
                invalid:
                    "import { inject as wire } from '#/infra/di/inject'; export const first = wire(deps)(() => 1); export const second = () => 2;",
                valid: "import { inject as wire } from '#/infra/di/inject'; export const first = wire(deps)(() => 1); export const second = 2;",
            },
            {
                rule: 'no-type-only-private-module-import',
                messageId: 'noTypeOnlyPrivateModuleImport',
                filename: 'src/modules/Example/useCases/example.ts',
                invalid: "import type { Thing } from '#/modules/Other/models/Thing';",
                valid: "import type { Thing } from '#/modules/Example/models/Thing';",
            },
            {
                rule: 'no-type-assertion-escape',
                messageId: 'noAsUnknownAs',
                filename: 'src/modules/Example/useCases/example.ts',
                invalid: 'const value = input as unknown as string;',
                valid: 'const value = input as unknown;',
            },
            {
                rule: 'no-type-assertion-escape',
                messageId: 'noAsAny',
                filename: 'src/modules/Example/useCases/example.ts',
                invalid: 'const value = input as any;',
                valid: 'const value = input as string;',
            },
        ];

        for (const fixture of cases) {
            const lint = (code: string) =>
                lintMigratedRules(code, fixture.filename).messages.filter(
                    (message) => message.ruleId === `sourdaw/${fixture.rule}`
                );
            const messages = rules[fixture.rule]?.meta?.messages;
            if (!messages) {
                throw new Error(`The ${fixture.rule} rule did not declare its diagnostic messages`);
            }
            const interpolated = new Map([
                [
                    'noMultipleFunctionExports',
                    'Use-case and repository files must export at most one function value. Found 2 exported functions: first, second.',
                ],
                [
                    'noTypeOnlyPrivateModuleImport',
                    'Do not import types from another module private folder (`models`). Use an events contract, public value contract derivation, or a local consumer-owned type.',
                ],
            ]);
            const expected = interpolated.get(fixture.messageId) ?? messages[fixture.messageId];
            if (expected === undefined) {
                throw new Error(`The ${fixture.rule} rule did not declare ${fixture.messageId}`);
            }
            expect(
                lint(fixture.invalid).map((message) => message.message),
                fixture.rule
            ).toEqual([expected]);
            expect(lint(fixture.valid), fixture.rule).toEqual([]);
        }

        expect(
            lintMigratedRules('task.then(value => Promise.resolve(value));')
                .messages.filter((message) => message.ruleId === 'promise-js/no-return-wrap')
                .map((message) => message.message)
        ).toHaveLength(1);
        expect(
            lintMigratedRules('task.then(value => value);').messages.filter(
                (message) => message.ruleId === 'promise-js/no-return-wrap'
            )
        ).toEqual([]);
    }, 180_000);

    it('fails the lint gate on a new violation of a promoted preset rule', async () => {
        const result = lintMigratedRules('export const Comment = () => <div>// note</div>;\n', 'src/app/Comment.tsx');
        expect(
            result.messages
                .filter((message) => message.ruleId === '@eslint-react/jsx-no-comment-textnodes')
                .map((message) => message.severity)
        ).toEqual(['error']);
        expect(result.status).toBe(1);
    }, 60_000);

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

    // Load retained TypeScript programs after subprocess probes so their compiler heaps do not overlap.

    it('still rejects all four typed service gaps through the retained ESLint route', async () => {
        const directory = mkdtempSync(resolve('src/app/retained-lint-'));
        const fixture = join(directory, 'Example.tsx');
        const code = `import { useQuery, type UseQueryResult } from '@tanstack/react-query';
declare function useWrapped(): UseQueryResult<number>;
export function useExample() {
    const { data, ...rest } = useWrapped();
    const query = useQuery({ queryKey: ['item'], queryFn: () => { console.log('missing return'); } });
    return { data, rest, query };
}
export function Example<T>({ count }: { count: number }) {
    return <div>{count && <span />}</div>;
}
`;
        try {
            writeFileSync(fixture, code);
            clearCaches();
            const [result] = await new ESLint().lintText(code, { filePath: fixture });
            expect(result?.fatalErrorCount, JSON.stringify(result?.messages)).toBe(0);
            expect(result?.messages.map((message) => message.ruleId)).toEqual(
                expect.arrayContaining([
                    '@eslint-react/no-leaked-conditional-rendering',
                    '@tanstack/query/no-void-query-fn',
                    '@tanstack/query/no-rest-destructuring',
                    '@typescript-eslint/naming-convention',
                ])
            );
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    }, 60_000);

    it('retains comment hygiene whose blanket-directive diagnostics need negative columns', async () => {
        const directory = mkdtempSync(resolve('src/app/retained-comments-'));
        const fixture = join(directory, 'example.ts');
        const invalid = `/* eslint-disable sourdaw/no-enum */
/* eslint-disable sourdaw/no-enum */
/* eslint-disable sourdaw/no-type-assertion-escape */
/* eslint-enable */
/* eslint-enable sourdaw/no-enum */
/* eslint-disable */
/* eslint-disable */
export const value = 1;
`;
        const valid = `/* eslint-disable sourdaw/no-enum */
export const value = 1;
/* eslint-enable sourdaw/no-enum */
`;
        try {
            writeFileSync(fixture, invalid);
            // CI uses single-run programs, whose initial file list predates this fixture.
            clearCaches();
            const eslint = new ESLint();
            const [rejected] = await eslint.lintText(invalid, { filePath: fixture });
            expect(rejected?.fatalErrorCount, JSON.stringify(rejected?.messages)).toBe(0);
            expect(rejected?.messages.map((message) => message.ruleId)).toEqual(
                expect.arrayContaining([
                    '@eslint-community/eslint-comments/disable-enable-pair',
                    '@eslint-community/eslint-comments/no-aggregating-enable',
                    '@eslint-community/eslint-comments/no-duplicate-disable',
                    '@eslint-community/eslint-comments/no-unlimited-disable',
                    '@eslint-community/eslint-comments/no-unused-enable',
                ])
            );
            const [accepted] = await eslint.lintText(valid, { filePath: fixture });
            expect(accepted?.fatalErrorCount, JSON.stringify(accepted?.messages)).toBe(0);
            expect(
                accepted?.messages.filter((message) => message.ruleId?.startsWith('@eslint-community/eslint-comments/'))
            ).toEqual([]);
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    }, 60_000);
});
