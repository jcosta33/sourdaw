import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

import { typeQueryLintFixtures } from './helpers/typeQueryLintFixtures.ts';
import { lintMigratedRules, runProductionLint } from './helpers/lintMigratedRules.ts';

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

describe('production Oxlint public-plugin migration', () => {
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

    it('runs migrated rules in Oxlint and keeps only service gaps and core rules active in ESLint', async () => {
        const eslint = new ESLint();
        const config = await eslint.calculateConfigForFile(resolve('src/app/App.tsx'));
        if (!config) {
            throw new Error('ESLint did not load the app configuration');
        }
        const active = Object.entries(config.rules)
            .filter(([, setting]) => setting[0] !== 0)
            .map(([name]) => name);
        expect(active.sort()).toEqual(
            [
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
            const [result] = await new ESLint().lintText(code, { filePath: fixture });
            expect(result?.fatalErrorCount).toBe(0);
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
            const eslint = new ESLint();
            const [rejected] = await eslint.lintText(invalid, { filePath: fixture });
            expect(rejected?.fatalErrorCount).toBe(0);
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
            expect(
                accepted?.messages.filter((message) => message.ruleId?.startsWith('@eslint-community/eslint-comments/'))
            ).toEqual([]);
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    }, 60_000);
});
