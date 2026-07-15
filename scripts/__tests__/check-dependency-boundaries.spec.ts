import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import {
    collectCausalEdges,
    compareRows,
    findMixedTypeValueExports,
    isModuleRootIndex,
    isUseCaseBarrel,
} from '../check-dependency-boundaries.mjs';

const require = createRequire(import.meta.url);
const mainConfig = require('../../.dependency-cruiser.cjs');
const testConfig = require('../../.dependency-cruiser.tests.cjs');
const typeConfig = require('../../.dependency-cruiser.types.cjs');

const rule = {
    severity: 'error',
    name: 'components-no-usecase-transitively',
};

describe('check-dependency-boundaries', () => {
    it('should collapse endpoint expansion to the first causal use-case edge', () => {
        const cruise = {
            summary: {
                violations: [
                    {
                        type: 'reachability',
                        from: 'src/modules/Foo/presentations/components/Leaf.tsx',
                        to: 'src/modules/Bar/useCases/a.ts',
                        via: [{ name: 'src/modules/Bar/useCases/index.ts' }],
                        rule,
                    },
                    {
                        type: 'reachability',
                        from: 'src/modules/Foo/presentations/components/Leaf.tsx',
                        to: 'src/modules/Bar/useCases/b.ts',
                        via: [{ name: 'src/modules/Bar/useCases/index.ts' }],
                        rule,
                    },
                ],
            },
            modules: [],
        };

        expect(collectCausalEdges(cruise)).toEqual([
            {
                type: 'reachability-causal',
                from: 'src/modules/Foo/presentations/components/Leaf.tsx',
                to: 'src/modules/Bar/useCases/index.ts',
                rule,
            },
        ]);
    });

    it('should preserve distinct direct use-case crossings', () => {
        const cruise = {
            summary: { violations: [] },
            modules: [
                {
                    source: 'src/components/Leaf.tsx',
                    dependencies: [
                        { resolved: 'src/modules/Bar/useCases/index.ts' },
                        { resolved: 'src/modules/Baz/useCases/index.ts' },
                    ],
                },
            ],
        };

        expect(collectCausalEdges(cruise)).toHaveLength(2);
    });

    it('should report both novel and stale baseline rows', () => {
        const oldRow = { type: 'dependency', from: 'a.ts', to: 'b.ts', rule };
        const newRow = { type: 'dependency', from: 'a.ts', to: 'c.ts', rule };

        expect(compareRows({ current: [newRow], known: [oldRow] })).toEqual({
            novel: [newRow],
            stale: [oldRow],
        });
    });

    it('should detect mixed type and value re-exports', () => {
        const source = "export { run, type RunInput } from './run';\n";

        expect(findMixedTypeValueExports(source, 'useCases/index.ts')).toEqual([
            { file: 'useCases/index.ts', line: 1 },
        ]);
        expect(
            findMixedTypeValueExports("export { run } from './run';\nexport type { RunInput } from './run';\n")
        ).toEqual([]);
    });

    it('should recognize only module-root index files', () => {
        expect(isModuleRootIndex('src/modules/Foo/index.ts')).toBe(true);
        expect(isModuleRootIndex('src/modules/Common/Foo/index.ts')).toBe(true);
        expect(isModuleRootIndex('src\\modules\\Foo\\index.ts')).toBe(true);
        expect(isModuleRootIndex('src/modules/Foo/useCases/index.ts')).toBe(false);
        expect(isUseCaseBarrel('src\\modules\\Foo\\useCases\\index.ts')).toBe(true);
    });

    it('should capture namespaced modules as distinct modules', () => {
        const ruleConfig = mainConfig.forbidden.find(
            (candidate: { name: string }) => candidate.name === 'cross-module-index-only'
        );
        const match = new RegExp(ruleConfig.from.path).exec('src/modules/Common/Foo/useCases/run.ts');

        expect(match?.slice(1)).toEqual(['src/modules/Common/', 'Foo']);
    });

    it('should include tests outside modules and global test setup', () => {
        const ruleConfig = testConfig.forbidden.find(
            (candidate: { name: string }) => candidate.name === 'external-tests-contract-only'
        );
        const matches = (filePath: string): boolean =>
            ruleConfig.from.path.some((pattern: string) => new RegExp(pattern).test(filePath));

        expect(matches('src/components/daw/__tests__/RotaryKnob.spec.tsx')).toBe(true);
        expect(matches('src/setupTests.ts')).toBe(true);
        expect(testConfig.options.exoticRequireStrings).toContain('vi.mock');

        const unresolvedRule = testConfig.forbidden.find(
            (candidate: { name: string }) => candidate.name === 'test-dependencies-must-resolve'
        );
        expect(unresolvedRule.to.couldNotResolve).toBe(true);
    });

    it('should isolate worklets from foreign modules and resolved Tauri packages', () => {
        const moduleRule = mainConfig.forbidden.find(
            (candidate: { name: string }) => candidate.name === 'worklets-no-module-runtime-imports'
        );
        const tauriRule = mainConfig.forbidden.find(
            (candidate: { name: string }) => candidate.name === 'worklets-no-app-helper-or-tauri'
        );

        expect(new RegExp(moduleRule.to.path).test('src/modules/Bar/useCases/run.ts')).toBe(true);
        expect(new RegExp(tauriRule.to.path).test('/node_modules/.pnpm/@tauri-apps/api/index.js')).toBe(true);
    });

    it('should keep changed zero-debt rules behaviorally exercised', () => {
        const viewRule = mainConfig.forbidden.find(
            (candidate: { name: string }) => candidate.name === 'components-no-view-access'
        );
        const reactRule = mainConfig.forbidden.find(
            (candidate: { name: string }) => candidate.name === 'react-only-in-presentation'
        );

        expect(new RegExp(viewRule.from.path).test('src/components/SharedControl.tsx')).toBe(true);
        expect(new RegExp(viewRule.from.path).test('src/modules/Foo/presentations/components/Leaf.tsx')).toBe(true);
        expect(new RegExp(reactRule.to.path).test('/node_modules/react/index.js')).toBe(true);
        expect(new RegExp(reactRule.to.path).test('/node_modules/react/jsx-runtime.js')).toBe(false);
    });

    it('should enforce Tauri IPC origins against resolved packages and bridge laundering', () => {
        const tauriRule = mainConfig.forbidden.find(
            (candidate: { name: string }) => candidate.name === 'tauri-ipc-only-in-repositories'
        );
        const matches = (patterns: string | string[], filePath: string): boolean => {
            const patternList = Array.isArray(patterns) ? patterns : [patterns];
            return patternList.some((pattern) => new RegExp(pattern).test(filePath));
        };
        const violates = (from: string, to: string): boolean =>
            matches(tauriRule.from.path, from) &&
            !matches(tauriRule.from.pathNot, from) &&
            matches(tauriRule.to.path, to);
        const resolvedTauriPaths = [
            '/node_modules/.pnpm/@tauri-apps+api@2.5.0/node_modules/@tauri-apps/api/index.js',
            '/node_modules/.pnpm/@tauri-apps+plugin-fs@2.5.0/node_modules/@tauri-apps/plugin-fs/dist-js/index.js',
        ];

        expect(tauriRule.severity).toBe('error');
        for (const resolvedTauriPath of resolvedTauriPaths) {
            expect(violates('src/modules/Foo/useCases/run.ts', resolvedTauriPath)).toBe(true);
            expect(violates('src/modules/Foo/repositories/read.ts', resolvedTauriPath)).toBe(false);
        }
        expect(violates('src/modules/Foo/useCases/run.ts', 'src/utils/tauriBridge.ts')).toBe(true);
        expect(violates('src/utils/tauriBridge.ts', resolvedTauriPaths[0])).toBe(false);
    });

    it('should enforce TitleCase model targets from the configured rule', () => {
        const modelRule = mainConfig.forbidden.find(
            (candidate: { name: string }) => candidate.name === 'models-must-be-title-case'
        );

        expect(modelRule.severity).toBe('error');
        expect(new RegExp(modelRule.to.path).test('src/modules/Foo/models/fooBar.ts')).toBe(true);
        expect(new RegExp(modelRule.to.path).test('src/modules/Foo/models/FooBar.ts')).toBe(false);
    });

    it('should apply architecture boundaries to type-only edges', () => {
        const typeRuleNames = new Set(typeConfig.forbidden.map((candidate: { name: string }) => candidate.name));

        expect([...typeRuleNames]).toEqual(
            expect.arrayContaining([
                'application-to-modules-public-surface-only-type-only',
                'models-are-pure-type-only',
                'no-relative-cross-module-imports-type-only',
                'react-only-in-presentation-type-only',
            ])
        );
    });
});
