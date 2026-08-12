import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { performance } from 'node:perf_hooks';

import { describe, expect, it } from 'vitest';

import {
    collectCausalEdges,
    compareRows,
    findMixedTypeValueExports,
    findModelCasingFindings,
    findStaticGuardFindings,
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

type FixtureContents = string | readonly string[];
type StaticGuardFinding = {
    file: string;
    line: number;
    reason: string;
};
type StaticGuardFindingsFunction = (repositoryRoot: string) => StaticGuardFinding[];
type CommonJsStaticGuardFixture = {
    repositoryDirectory: string;
    repositoryRoot: string;
    useCaseDirectory: string;
};

function writeFixtureFiles(directory: string, fixtures: Record<string, FixtureContents>): void {
    for (const [fileName, contents] of Object.entries(fixtures)) {
        writeFileSync(join(directory, fileName), Array.isArray(contents) ? `${contents.join('\n')}\n` : contents);
    }
}

function vendorFinding(file: string, line: number, moduleSpecifier = '@tauri-apps/api/core') {
    return {
        file,
        line,
        reason: `repository public type surface exposes Tauri vendor type from ${moduleSpecifier}`,
    };
}

function unsupportedCommonJsFinding(file: string, line: number) {
    return {
        file,
        line,
        reason: 'unsupported CommonJS public-surface mutation cannot be statically inspected',
    };
}

function createCommonJsStaticGuardFixture(prefix: string): CommonJsStaticGuardFixture {
    const repositoryRoot = mkdtempSync(join(tmpdir(), prefix));
    const moduleDirectory = join(repositoryRoot, 'src/modules/Foo');
    const repositoryDirectory = join(moduleDirectory, 'repositories');
    const useCaseDirectory = join(moduleDirectory, 'useCases');
    const vendorDirectory = join(repositoryRoot, 'node_modules/@tauri-apps/api');
    mkdirSync(repositoryDirectory, { recursive: true });
    mkdirSync(useCaseDirectory, { recursive: true });
    mkdirSync(vendorDirectory, { recursive: true });

    writeFixtureFiles(repositoryRoot, {
        'package.json': JSON.stringify({ type: 'module' }),
        'src/globals.d.ts': [
            'declare let module: {',
            '    exports: Record<string, unknown>;',
            '    require: (moduleName: string) => any;',
            '};',
            'declare let exports: Record<string, unknown>;',
            'declare let require: (moduleName: string) => any;',
        ],
    });
    writeFixtureFiles(vendorDirectory, {
        'package.json': JSON.stringify({
            name: '@tauri-apps/api',
            type: 'module',
            exports: {
                './core': {
                    types: './core.d.ts',
                    default: './core.js',
                },
            },
        }),
        'core.js': 'export const invoke = null;\n',
        'core.d.ts': 'export type InvokeArgs = { command: string };\n',
    });

    return { repositoryDirectory, repositoryRoot, useCaseDirectory };
}

function isStaticGuardFindingsFunction(value: unknown): value is StaticGuardFindingsFunction {
    return typeof value === 'function';
}

function invokeStaticGuardFindings(repositoryRoot: string): StaticGuardFinding[] {
    const candidate: unknown = findStaticGuardFindings;
    if (!isStaticGuardFindingsFunction(candidate)) {
        throw new TypeError('findStaticGuardFindings is not callable');
    }
    return candidate(repositoryRoot);
}

function isUnsupportedSymlinkError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null || !('code' in error)) {
        return false;
    }
    return typeof error.code === 'string' && ['EACCES', 'ENOSYS', 'EOPNOTSUPP', 'EPERM'].includes(error.code);
}

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

    it('should recognize module-root index files across supported extensions and casing', () => {
        const moduleRootEntries = [
            'src/modules/Foo/index.ts',
            'src/modules/Foo/Index.ts',
            'src/modules/Foo/index.tsx',
            'src/modules/Foo/index.js',
            'src/modules/Foo/Index.JSX',
            'src/modules/Foo/index.mjs',
            'src/modules/Foo/index.cjs',
            'src/modules/Foo/index.mts',
            'src/modules/Foo/index.cts',
            'src/modules/Foo/index.d.ts',
            'src/modules/Foo/Index.D.MTS',
            'src/modules/Common/Foo/Index.tsx',
            'src/modules/Supporting/Foo/INDEX.JS',
            'src\\modules\\Foo\\Index.TSX',
        ];

        for (const filePath of moduleRootEntries) {
            expect(isModuleRootIndex(filePath), filePath).toBe(true);
        }

        const contractEntries = [
            'src/modules/Foo/useCases/index.ts',
            'src/modules/Foo/useCases/Index.tsx',
            'src/modules/Foo/events/index.js',
            'src/modules/Foo/stores/Index.d.ts',
            'src/modules/Foo/presentations/views/index.mts',
        ];

        for (const filePath of contractEntries) {
            expect(isModuleRootIndex(filePath), filePath).toBe(false);
        }

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
        expect(mainConfig.options.exclude.path).toContain('spec');
        expect(testConfig.options.exclude).toBeUndefined();

        const unresolvedRule = testConfig.forbidden.find(
            (candidate: { name: string }) => candidate.name === 'test-dependencies-must-resolve'
        );
        expect(unresolvedRule.to.couldNotResolve).toBe(true);
    });

    it('should enforce module contract barrels from the real app composition root', () => {
        const appRule = mainConfig.forbidden.find(
            (candidate: { name: string }) => candidate.name === 'app-to-modules-public-surface-only'
        );
        const typeAppRule = typeConfig.forbidden.find(
            (candidate: { name: string }) => candidate.name === 'app-to-modules-public-surface-only-type-only'
        );

        expect(new RegExp(appRule.from.path).test('src/app/bootstrap.ts')).toBe(true);
        expect(new RegExp(typeAppRule.from.path).test('src/app/registerDependencies.ts')).toBe(true);
        expect(new RegExp(appRule.from.path).test('application/bootstrap.ts')).toBe(false);
        expect(new RegExp(appRule.to.path).test('src/modules/Transport/handlers/getHandlers.ts')).toBe(true);
        expect(
            appRule.to.pathNot.some((pattern: string) =>
                new RegExp(pattern).test('src/modules/Transport/useCases/index.ts')
            )
        ).toBe(true);
    });

    it('should exclude test-only helpers without hiding production orphans', () => {
        const orphanRule = mainConfig.forbidden.find((candidate: { name: string }) => candidate.name === 'no-orphans');
        const isExcluded = (filePath: string): boolean =>
            orphanRule.from.pathNot.some((pattern: string) => new RegExp(pattern).test(filePath));

        expect(
            isExcluded('src/modules/AudioEngine/repositories/offlineScheduler/__tests__/offlineAutomationExemptions.ts')
        ).toBe(true);
        expect(isExcluded('src/modules/ControlSurface/repositories/pushMidiCodec.ts')).toBe(false);
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

    it('should block reverse imports into AudioEngine worklets while keeping the Yeast Worker client separate', () => {
        const reverseRule = mainConfig.forbidden.find(
            (candidate: { name: string }) => candidate.name === 'module-runtime-no-worklet-imports'
        );

        expect(reverseRule).toBeDefined();
        expect(new RegExp(reverseRule.from.path).test('src/modules/Yeast/useCases/addYeastProcessor.ts')).toBe(true);
        expect(new RegExp(reverseRule.from.path).test('src/modules/Yeast/stores/yeastStore.ts')).toBe(true);
        expect(new RegExp(reverseRule.from.path).test('src/modules/Yeast/repositories/load.ts')).toBe(true);
        expect(new RegExp(reverseRule.from.path).test('src/modules/Yeast/handlers/run.ts')).toBe(true);
        expect(new RegExp(reverseRule.from.path).test('src/modules/Yeast/presentations/views/YeastPanel.tsx')).toBe(
            true
        );
        expect(new RegExp(reverseRule.to.path).test('src/modules/AudioEngine/worklets/MidiRack.ts')).toBe(true);
        expect(new RegExp(reverseRule.from.path).test('src/modules/Yeast/engine/YeastWorkerClient.ts')).toBe(false);

        const testReverseRule = testConfig.forbidden.find(
            (candidate: { name: string }) => candidate.name === 'module-runtime-no-worklet-imports'
        );
        const testFromMatches = (filePath: string): boolean =>
            testReverseRule.from.path.some((pattern: string) => new RegExp(pattern).test(filePath));

        expect(testFromMatches('src/modules/Yeast/useCases/__tests__/runtime.spec.ts')).toBe(true);
        expect(testFromMatches('src/modules/Yeast/repositories/__tests__/load.spec.ts')).toBe(true);
        expect(testFromMatches('src/modules/Yeast/stores/__tests__/yeastStore.spec.ts')).toBe(true);
        expect(testFromMatches('src/modules/Yeast/handlers/__tests__/run.spec.ts')).toBe(true);
        expect(testFromMatches('src/modules/Yeast/presentations/views/__tests__/YeastPanel.spec.tsx')).toBe(true);
        expect(new RegExp(testReverseRule.to.path).test('src/modules/AudioEngine/worklets/MidiRack.ts')).toBe(true);
    });

    it('should isolate dedicated Workers and block reverse Worker imports', () => {
        const workerRule = mainConfig.forbidden.find(
            (candidate: { name: string }) => candidate.name === 'workers-no-module-runtime-imports'
        );
        const reverseRule = mainConfig.forbidden.find(
            (candidate: { name: string }) => candidate.name === 'module-runtime-no-worker-imports'
        );
        const tauriRule = mainConfig.forbidden.find(
            (candidate: { name: string }) => candidate.name === 'workers-no-app-helper-or-tauri'
        );
        const testReverseRule = testConfig.forbidden.find(
            (candidate: { name: string }) => candidate.name === 'module-runtime-no-worker-imports'
        );

        expect(workerRule).toBeDefined();
        expect(reverseRule).toBeDefined();
        expect(tauriRule).toBeDefined();
        expect(testReverseRule).toBeDefined();
        expect(new RegExp(workerRule.to.path).test('src/modules/Yeast/useCases/run.ts')).toBe(true);
        expect(new RegExp(reverseRule.from.path).test('src/modules/Yeast/useCases/run.ts')).toBe(true);
        expect(new RegExp(reverseRule.to.path).test('src/modules/Yeast/workers/MidiRack.ts')).toBe(true);
        expect(new RegExp(reverseRule.from.path).test('src/modules/Yeast/engine/YeastWorkerClient.ts')).toBe(false);
        expect(new RegExp(tauriRule.to.path).test('/node_modules/.pnpm/@tauri-apps/api/index.js')).toBe(true);
        expect(new RegExp(testReverseRule.to.path).test('src/modules/Yeast/workers/MidiRack.ts')).toBe(true);
    });

    it('should keep changed zero-debt rules behaviorally exercised', () => {
        const viewRule = mainConfig.forbidden.find(
            (candidate: { name: string }) => candidate.name === 'components-no-view-access'
        );
        const reactRule = mainConfig.forbidden.find(
            (candidate: { name: string }) => candidate.name === 'react-only-in-presentation'
        );
        const reactPathPatterns = Array.isArray(reactRule.to.path) ? reactRule.to.path : [reactRule.to.path];

        function matchesReactPath(path: string): boolean {
            return reactPathPatterns.some((pattern: string) => new RegExp(pattern).test(path));
        }

        expect(new RegExp(viewRule.from.path).test('src/components/SharedControl.tsx')).toBe(true);
        expect(new RegExp(viewRule.from.path).test('src/modules/Foo/presentations/components/Leaf.tsx')).toBe(true);
        expect(matchesReactPath('/node_modules/react/index.js')).toBe(true);
        expect(matchesReactPath('/node_modules/react/jsx-runtime.js')).toBe(true);
        expect(matchesReactPath('/node_modules/react/jsx-dev-runtime.js')).toBe(true);
        expect(matchesReactPath('/node_modules/react-dom/index.js')).toBe(false);
    });

    it('should enforce Tauri IPC origins against resolved packages and bridge laundering', () => {
        const tauriRule = mainConfig.forbidden.find(
            (candidate: { name: string }) => candidate.name === 'tauri-ipc-only-in-repositories'
        );
        const testTauriRule = testConfig.forbidden.find(
            (candidate: { name: string }) => candidate.name === 'tauri-ipc-only-in-repositories'
        );
        const matches = (patterns: string | string[], filePath: string): boolean => {
            const patternList = Array.isArray(patterns) ? patterns : [patterns];
            return patternList.some((pattern) => new RegExp(pattern).test(filePath));
        };
        const violates = (
            ruleConfig: { from: { path: string | string[]; pathNot?: string | string[] }; to: { path: string } },
            from: string,
            to: string
        ): boolean =>
            matches(ruleConfig.from.path, from) &&
            !matches(ruleConfig.from.pathNot ?? [], from) &&
            matches(ruleConfig.to.path, to);
        const resolvedTauriPaths = [
            '/node_modules/.pnpm/@tauri-apps+api@2.5.0/node_modules/@tauri-apps/api/index.js',
            '/node_modules/.pnpm/@tauri-apps+plugin-fs@2.5.0/node_modules/@tauri-apps/plugin-fs/dist-js/index.js',
        ];
        const nonModuleOrigins = [
            'src/infra/tauriClient.ts',
            'src/components/TauriClient.tsx',
            'src/app/tauriClient.ts',
            'src/routes/tauriClient.ts',
            'src/shared/tauriClient.ts',
            'src/helpers/tauriClient.ts',
            'src/types/tauriClient.d.ts',
            'src/utils/otherBridge.ts',
            'src/utils/__tests__/other.spec.ts',
        ];
        const allowedRepositoryOrigins = [
            'src/modules/Foo/repositories/read.ts',
            'src/modules/Common/Foo/repositories/read.ts',
            'src/modules/Supporting/Foo/repositories/read.ts',
        ];
        const nestedRepositoryOrigins = [
            'src/modules/Foo/useCases/repositories/tauriClient.ts',
            'src/modules/Foo/presentations/repositories/tauriClient.ts',
            'src/modules/Foo/repositoriesSibling/tauriClient.ts',
        ];

        expect(tauriRule.severity).toBe('error');
        expect(testTauriRule).toBe(tauriRule);
        for (const resolvedTauriPath of resolvedTauriPaths) {
            expect(violates(tauriRule, 'src/modules/Foo/useCases/run.ts', resolvedTauriPath)).toBe(true);
            for (const origin of nonModuleOrigins) {
                expect(violates(tauriRule, origin, resolvedTauriPath)).toBe(true);
            }
            for (const origin of allowedRepositoryOrigins) {
                expect(violates(tauriRule, origin, resolvedTauriPath)).toBe(false);
            }
            for (const origin of nestedRepositoryOrigins) {
                expect(violates(tauriRule, origin, resolvedTauriPath)).toBe(true);
            }
        }
        expect(violates(tauriRule, 'src/modules/Foo/useCases/run.ts', 'src/utils/tauriBridge.ts')).toBe(true);
        expect(violates(tauriRule, 'src/utils/tauriBridge.ts', resolvedTauriPaths[0])).toBe(false);
        expect(violates(tauriRule, 'src/utils/__tests__/tauriBridge.spec.ts', resolvedTauriPaths[0])).toBe(false);
        expect(violates(tauriRule, allowedRepositoryOrigins[0], 'src/utils/tauriBridge.ts')).toBe(false);
        expect(violates(tauriRule, 'src/utils/otherBridge.ts', 'src/utils/tauriBridge.ts')).toBe(true);
        expect(violates(testTauriRule, 'src/modules/Foo/useCases/__tests__/run.spec.ts', resolvedTauriPaths[0])).toBe(
            true
        );
    });

    it('should apply Tauri IPC confinement to type-only edges', () => {
        const tauriRule = mainConfig.forbidden.find(
            (candidate: { name: string }) => candidate.name === 'tauri-ipc-only-in-repositories'
        );
        const typeTauriRule = typeConfig.forbidden.find(
            (candidate: { name: string }) => candidate.name === 'tauri-ipc-only-in-repositories-type-only'
        );
        const matches = (patterns: string | string[] | undefined, filePath: string): boolean => {
            let patternList: string[];
            if (Array.isArray(patterns)) {
                patternList = patterns;
            } else if (patterns) {
                patternList = [patterns];
            } else {
                patternList = [];
            }
            return patternList.some((pattern) => new RegExp(pattern).test(filePath));
        };
        const violates = (from: string, to: string): boolean =>
            matches(typeTauriRule.from.path, from) &&
            !matches(typeTauriRule.from.pathNot, from) &&
            matches(typeTauriRule.to.path, to) &&
            typeTauriRule.to.dependencyTypes.includes('type-only');

        expect(typeTauriRule).toBeDefined();
        expect(typeTauriRule.to.dependencyTypes).toEqual(['type-only']);
        expect(typeTauriRule.from).toEqual(tauriRule.from);
        expect(typeTauriRule.to.path).toBe(tauriRule.to.path);
        expect(typeTauriRule.to.pathNot).toEqual(tauriRule.to.pathNot);

        const resolvedTauriPath = '/node_modules/.pnpm/@tauri-apps+api@2.5.0/node_modules/@tauri-apps/api/index.d.ts';
        expect(violates('src/modules/Foo/useCases/run.ts', resolvedTauriPath)).toBe(true);
        expect(violates('src/infra/tauriTypes.ts', resolvedTauriPath)).toBe(true);
        expect(violates('src/modules/Foo/repositories/read.ts', resolvedTauriPath)).toBe(false);
        expect(violates('src/utils/tauriBridge.ts', resolvedTauriPath)).toBe(false);
        expect(violates('src/utils/__tests__/tauriBridge.spec.ts', resolvedTauriPath)).toBe(false);
        expect(violates('src/modules/Foo/useCases/__tests__/run.spec.ts', resolvedTauriPath)).toBe(true);
        expect(violates('src/modules/Foo/useCases/run.ts', 'src/utils/tauriBridge.ts')).toBe(true);
        expect(violates('src/modules/Foo/repositories/read.ts', 'src/utils/tauriBridge.ts')).toBe(false);
    });

    it('should reject Tauri vendor types crossing repository public surfaces', () => {
        let repositoryRoot: string | undefined;

        try {
            repositoryRoot = mkdtempSync(join(tmpdir(), 'check-dependency-boundaries-tauri-types-'));
            const moduleDirectory = join(repositoryRoot, 'src/modules/Foo');
            const repositoryDirectory = join(moduleDirectory, 'repositories');
            const useCaseDirectory = join(moduleDirectory, 'useCases');
            mkdirSync(repositoryDirectory, { recursive: true });
            mkdirSync(useCaseDirectory, { recursive: true });

            writeFixtureFiles(repositoryDirectory, {
                'direct-export.ts': "export type { InvokeArgs } from '@tauri-apps/api/core';\n",
                'bridge.ts': [
                    "import type { TauriChannel as BridgeChannel } from '#/utils/tauriBridge';",
                    'export type PublicChannel = BridgeChannel<unknown>;',
                    "export { type TauriChannel } from '#/utils/tauriBridge';",
                ],
                'alias.ts': [
                    "import type { InvokeArgs as TauriInvokeArgs } from '@tauri-apps/api/core';",
                    'type LocalInvokeArgs = TauriInvokeArgs;',
                    'export type PublicInvokeArgs = LocalInvokeArgs;',
                    'export interface PublicRequest { args: LocalInvokeArgs; }',
                    'export function send(args: LocalInvokeArgs): LocalInvokeArgs { return args; }',
                    'export function implementationOnly(): void {',
                    '    const args = null as unknown as TauriInvokeArgs;',
                    '    void args;',
                    '}',
                    'function privateOnly(args: TauriInvokeArgs): TauriInvokeArgs { return args; }',
                    'void privateOnly;',
                ],
                'inline.mts': [
                    "export type InlineInvokeArgs = import('@tauri-apps/api/core').InvokeArgs;",
                    "export function inline(args: import('@tauri-apps/api/core').InvokeArgs): void { void args; }",
                ],
                'jsdoc.js': [
                    '/**',
                    " * @param {import('@tauri-apps/api/core').InvokeArgs} args",
                    ' */',
                    'export function jsdocPublic(args) { return args; }',
                ],
                'owner-dto.ts': 'export type OwnerRequest = { args: Record<string, unknown> };\n',
            });

            for (const extension of ['.cjs', '.d.ts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']) {
                writeFileSync(
                    join(repositoryDirectory, `direct-star${extension}`),
                    "export * from '@tauri-apps/api/core';\n"
                );
            }
            writeFixtureFiles(useCaseDirectory, {
                'consume.ts': [
                    "import type { InvokeArgs } from '../repositories/direct-export';",
                    "import type { InlineInvokeArgs } from '../repositories/inline.mts';",
                    "import { inline } from '../repositories/inline.mts';",
                    "import { jsdocPublic } from '../repositories/jsdoc.js';",
                    "import type { PublicInvokeArgs } from '../repositories/alias';",
                    "import type { PublicRequest } from '../repositories/alias';",
                    "import { send } from '../repositories/alias';",
                    "import type { PublicChannel, TauriChannel } from '../repositories/bridge';",
                    'export function consume(args: InvokeArgs, aliased: PublicInvokeArgs): void {',
                    '    void args;',
                    '    void aliased;',
                    '    void (null as unknown as InlineInvokeArgs);',
                    '    void inline;',
                    '    void jsdocPublic;',
                    '    void (null as unknown as PublicRequest);',
                    '    void send;',
                    '    void (null as unknown as PublicChannel);',
                    '    void (null as unknown as TauriChannel);',
                    '}',
                ],
            });
            const directStarExtensions = ['.cjs', '.d.ts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx'];

            for (const [index, extension] of directStarExtensions.entries()) {
                writeFileSync(
                    join(useCaseDirectory, `consume-direct-star-${index}.ts`),
                    `import * as directStar from '../repositories/direct-star${extension}';\nvoid directStar;\n`
                );
            }

            const findings = findStaticGuardFindings(repositoryRoot);
            const vendorFindings = findings.filter(({ reason }) => reason.includes('Tauri vendor type'));

            expect(vendorFindings).toEqual(
                expect.arrayContaining([
                    vendorFinding('src/modules/Foo/repositories/alias.ts', 3),
                    vendorFinding('src/modules/Foo/repositories/alias.ts', 4),
                    vendorFinding('src/modules/Foo/repositories/alias.ts', 5),
                    vendorFinding('src/modules/Foo/repositories/bridge.ts', 2, '#/utils/tauriBridge'),
                    vendorFinding('src/modules/Foo/repositories/bridge.ts', 3, '#/utils/tauriBridge'),
                    vendorFinding('src/modules/Foo/repositories/direct-export.ts', 1),
                    vendorFinding('src/modules/Foo/repositories/inline.mts', 1),
                    vendorFinding('src/modules/Foo/repositories/inline.mts', 2),
                    vendorFinding('src/modules/Foo/repositories/jsdoc.js', 4),
                ])
            );
            expect(vendorFindings).toHaveLength(17);
            expect(vendorFindings).not.toEqual(
                expect.arrayContaining([vendorFinding('src/modules/Foo/repositories/alias.ts', 6)])
            );
            for (const extension of ['.cjs', '.d.ts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']) {
                expect(vendorFindings).toContainEqual(
                    vendorFinding(`src/modules/Foo/repositories/direct-star${extension}`, 1)
                );
            }
            expect(vendorFindings.some(({ file }) => file.endsWith('/owner-dto.ts'))).toBe(false);
            expect(findings.some(({ file }) => file.endsWith('/useCases/consume.ts'))).toBe(false);
        } finally {
            if (repositoryRoot) {
                rmSync(repositoryRoot, { force: true, recursive: true });
            }
        }
    });

    it('should resolve exported vendor types across supported module forms and consumers', () => {
        let repositoryRoot: string | undefined;

        try {
            repositoryRoot = mkdtempSync(join(tmpdir(), 'check-dependency-boundaries-resolved-types-'));
            const moduleDirectory = join(repositoryRoot, 'src/modules/Foo');
            const repositoryDirectory = join(moduleDirectory, 'repositories');
            const useCaseDirectory = join(moduleDirectory, 'useCases');
            const vendorDirectory = join(repositoryRoot, 'node_modules/@tauri-apps/api');
            mkdirSync(repositoryDirectory, { recursive: true });
            mkdirSync(useCaseDirectory, { recursive: true });
            mkdirSync(vendorDirectory, { recursive: true });
            mkdirSync(join(repositoryRoot, 'src/utils'), { recursive: true });

            writeFixtureFiles(repositoryRoot, {
                'package.json': JSON.stringify({ type: 'module' }),
                'src/globals.d.ts': [
                    'declare const module: { exports: unknown };',
                    'declare const exports: Record<string, unknown>;',
                    'declare function require(moduleName: string): any;',
                    'declare const dynamicName: string;',
                ],
                'src/utils/tauriBridge.ts': 'export type BridgeChannel<T> = { value: T };\n',
            });
            writeFixtureFiles(vendorDirectory, {
                'package.json': JSON.stringify({
                    name: '@tauri-apps/api',
                    type: 'module',
                    exports: {
                        './core': {
                            types: './core.d.ts',
                            default: './core.js',
                        },
                    },
                }),
                'core.js': 'export const invoke = null;\n',
                'core.d.ts': [
                    'export type InvokeArgs = { command: string };',
                    'export type InvokeResult = { data: string };',
                    'export declare function invoke(args: InvokeArgs): Promise<InvokeResult>;',
                    'export declare const channel: <T>(value: T) => T;',
                ],
            });
            writeFixtureFiles(repositoryDirectory, {
                'export-assignment.cts': [
                    "import type { InvokeArgs } from '@tauri-apps/api/core';",
                    '',
                    'const request: InvokeArgs = null as unknown as InvokeArgs;',
                    'export = request;',
                ],
                'commonjs-module.cjs': [
                    "/** @type {import('@tauri-apps/api/core').InvokeArgs} */",
                    'const request = {};',
                    'module.exports = request;',
                ],
                'commonjs-name.js': [
                    '/**',
                    " * @param {import('@tauri-apps/api/core').InvokeArgs} args",
                    " * @returns {import('@tauri-apps/api/core').InvokeArgs}",
                    ' */',
                    'function send(args) {',
                    '    return args;',
                    '}',
                    'exports.send = send;',
                ],
                'require-destructured.mjs': [
                    "/** @type {typeof import('@tauri-apps/api/core')} */",
                    "const { invoke: tauriInvoke } = require('@tauri-apps/api/core');",
                    '',
                    '/** @returns {typeof tauriInvoke} */',
                    'function invokeFromNamespace() {',
                    '    return tauriInvoke;',
                    '}',
                    'module.exports = { invokeFromNamespace };',
                ],
                'require-namespace.cjs': [
                    "/** @type {typeof import('@tauri-apps/api/core')} */",
                    "const tauri = require('@tauri-apps/api/core');",
                    'module.exports = tauri;',
                ],
                'inferred.mts': [
                    "import { invoke } from '@tauri-apps/api/core';",
                    '',
                    'const request = { invoke };',
                    'const makeRequest = () => request;',
                    'class RequestBox {',
                    '    value = request;',
                    '    get() {',
                    '        return this.value;',
                    '    }',
                    '}',
                    'const makeGeneric = <T>(value: T) => ({ value, invoke });',
                    'export { request };',
                    'export { makeRequest };',
                    'export { RequestBox };',
                    'export { makeGeneric };',
                ],
                'chain-private.ts': [
                    "import { invoke } from '@tauri-apps/api/core';",
                    'const privateValue = { invoke };',
                    'export { privateValue };',
                ],
                'chain-one.ts': "export { privateValue as aliasValue } from './chain-private';\n",
                'chain-two.ts': "export { aliasValue as publicValue } from './chain-one';\n",
                'repo-only-helper.ts': [
                    "import type { InvokeArgs } from '@tauri-apps/api/core';",
                    'export type InternalRequest = InvokeArgs;',
                ],
                'repo-only-consumer.ts': [
                    "import type { InternalRequest } from './repo-only-helper';",
                    'export type OwnedRequest = { request: InternalRequest };',
                ],
                'external-helper.ts': [
                    "import type { InvokeArgs } from '@tauri-apps/api/core';",
                    'export type ExternalRequest = InvokeArgs;',
                ],
                'internal-implementation.ts': [
                    "import type { InvokeArgs } from '@tauri-apps/api/core';",
                    'export function internalImplementation(): void {',
                    '    const request = null as unknown as InvokeArgs;',
                    '    void request;',
                    '}',
                    'export class InternalImplementation {',
                    '    private request: InvokeArgs = null as unknown as InvokeArgs;',
                    '}',
                ],
            });
            writeFixtureFiles(useCaseDirectory, {
                'consume-resolved-types.cts': [
                    "import exportAssignment = require('../repositories/export-assignment');",
                    "import commonJs = require('../repositories/commonjs-module');",
                    "import { send } from '../repositories/commonjs-name.js';",
                    "import destructured = require('../repositories/require-destructured.mjs');",
                    "import namespace = require('../repositories/require-namespace.cjs');",
                    "import { request, makeRequest, RequestBox, makeGeneric } from '../repositories/inferred.mts';",
                    "import { publicValue } from '../repositories/chain-two';",
                    "import type { ExternalRequest } from '../repositories/external-helper';",
                    "import { internalImplementation, InternalImplementation } from '../repositories/internal-implementation';",
                    'export const consumed = [',
                    '    exportAssignment,',
                    '    commonJs,',
                    '    send,',
                    '    destructured,',
                    '    namespace,',
                    '    request,',
                    '    makeRequest,',
                    '    RequestBox,',
                    '    makeGeneric,',
                    '    publicValue,',
                    '    internalImplementation,',
                    '    InternalImplementation,',
                    '];',
                    'export type ConsumedRequest = ExternalRequest;',
                ],
            });

            const findings = findStaticGuardFindings(repositoryRoot).filter(({ reason }) =>
                reason.includes('Tauri vendor type')
            );

            expect(findings).toEqual(
                expect.arrayContaining([
                    vendorFinding('src/modules/Foo/repositories/export-assignment.cts', 4),
                    vendorFinding('src/modules/Foo/repositories/commonjs-module.cjs', 3),
                    vendorFinding('src/modules/Foo/repositories/commonjs-name.js', 8),
                    vendorFinding('src/modules/Foo/repositories/require-destructured.mjs', 8),
                    vendorFinding('src/modules/Foo/repositories/require-namespace.cjs', 3),
                    vendorFinding('src/modules/Foo/repositories/inferred.mts', 12),
                    vendorFinding('src/modules/Foo/repositories/inferred.mts', 13),
                    vendorFinding('src/modules/Foo/repositories/inferred.mts', 14),
                    vendorFinding('src/modules/Foo/repositories/inferred.mts', 15),
                    vendorFinding('src/modules/Foo/repositories/chain-two.ts', 1),
                    vendorFinding('src/modules/Foo/repositories/external-helper.ts', 2),
                ])
            );
            expect(findings).toHaveLength(11);
            expect(findings).not.toEqual(
                expect.arrayContaining([
                    vendorFinding('src/modules/Foo/repositories/repo-only-helper.ts', 2),
                    vendorFinding('src/modules/Foo/repositories/chain-private.ts', 3),
                ])
            );
        } finally {
            if (repositoryRoot) {
                rmSync(repositoryRoot, { force: true, recursive: true });
            }
        }
    });

    it('should keep clean runtime values, enumerate CJS exports, and consume import types', () => {
        let repositoryRoot: string | undefined;

        try {
            repositoryRoot = mkdtempSync(join(tmpdir(), 'check-dependency-boundaries-adversarial-types-'));
            const moduleDirectory = join(repositoryRoot, 'src/modules/Foo');
            const repositoryDirectory = join(moduleDirectory, 'repositories');
            const useCaseDirectory = join(moduleDirectory, 'useCases');
            const vendorDirectory = join(repositoryRoot, 'node_modules/@tauri-apps/api');
            mkdirSync(repositoryDirectory, { recursive: true });
            mkdirSync(useCaseDirectory, { recursive: true });
            mkdirSync(vendorDirectory, { recursive: true });

            writeFixtureFiles(repositoryRoot, {
                'package.json': JSON.stringify({ type: 'module' }),
                'src/globals.d.ts': [
                    'declare const module: { exports: unknown };',
                    'declare const exports: Record<string, unknown>;',
                    'declare function require(moduleName: string): any;',
                ],
            });
            writeFixtureFiles(vendorDirectory, {
                'package.json': JSON.stringify({
                    name: '@tauri-apps/api',
                    type: 'module',
                    exports: {
                        './core': {
                            types: './core.d.ts',
                            default: './core.js',
                        },
                    },
                }),
                'core.js': 'export const invoke = null;\n',
                'core.d.ts': [
                    'export type InvokeArgs = { command: string };',
                    'export declare function invoke<T>(command: string): Promise<T>;',
                ],
            });
            writeFixtureFiles(repositoryDirectory, {
                'runtime-only.ts': [
                    "import { invoke } from '@tauri-apps/api/core';",
                    '',
                    "export const runtimeString: string = invoke<string>('runtime-string') as unknown as string;",
                    "export const runtimePromise: Promise<string> = invoke<string>('runtime-promise');",
                    "export function runtimeFunction(): Promise<string> { return invoke<string>('runtime-function'); }",
                ],
                'factory-runtime.ts': [
                    "import { invoke } from '@tauri-apps/api/core';",
                    'declare function inject<T extends (...args: any[]) => any>(factory: () => T): T & ((...args: any[]) => any);',
                    'export const runtimeFactory = inject(() => async function runtimeFactory(): Promise<string> {',
                    "    return invoke<string>('factory-runtime');",
                    '});',
                ],
                'commonjs-surface.cjs': [
                    'const spread = {',
                    "    /** @param {import('@tauri-apps/api/core').InvokeArgs} args */",
                    '    spreadMethod(args) { return args; },',
                    '};',
                    'module.exports = {',
                    "    /** @param {import('@tauri-apps/api/core').InvokeArgs} args */",
                    '    directMethod(args) { return args; },',
                    "    /** @returns {import('@tauri-apps/api/core').InvokeArgs} */",
                    '    get directGetter() { return null; },',
                    '    ...spread,',
                    '};',
                ],
                'commonjs-fallback.cjs': [
                    'const hidden = /** @type {any} */ ({',
                    "    /** @param {import('@tauri-apps/api/core').InvokeArgs} args */",
                    '    hiddenMethod(args) { return args; },',
                    '});',
                    'module.exports = hidden;',
                ],
                'commonjs-partial.cjs': [
                    'module.exports = {',
                    "    /** @param {import('@tauri-apps/api/core').InvokeArgs} args */",
                    '    [dynamicName](args) { return args; },',
                    '};',
                ],
                'commonjs-clean-runtime.cjs': [
                    "const { invoke } = require('@tauri-apps/api/core');",
                    '/** @returns {Promise<string>} */',
                    "function cleanRuntime() { return invoke('clean-runtime'); }",
                    'module.exports = cleanRuntime;',
                ],
                'commonjs-assign-exports.cjs': [
                    'const source = {',
                    "    /** @param {import('@tauri-apps/api/core').InvokeArgs} args */",
                    '    exposed(args) { return args; },',
                    '};',
                    'Object.assign(exports, source);',
                ],
                'commonjs-assign-module.cjs': [
                    "const computedName = 'computedExposed';",
                    "const clean = { runtimeOnly: () => 'clean' };",
                    'const leaked = {',
                    "    /** @returns {import('@tauri-apps/api/core').InvokeArgs} */",
                    '    get [computedName]() { return null; },',
                    '};',
                    'Object.assign(module.exports, clean, leaked);',
                ],
                'commonjs-assign-dynamic.cjs': [
                    '/** @returns {any} */',
                    'function loadExports() {',
                    '    return {',
                    "        /** @param {import('@tauri-apps/api/core').InvokeArgs} args */",
                    '        dynamicLeak(args) { return args; },',
                    '    };',
                    '}',
                    'Object.assign(exports, loadExports());',
                ],
                'commonjs-assign-shadowed.cjs': [
                    'const Object = { assign() {} };',
                    "Object['assign'](exports, {",
                    "    /** @param {import('@tauri-apps/api/core').InvokeArgs} args */",
                    '    shadowed(args) { return args; },',
                    '});',
                ],
                'commonjs-assign-clean-runtime.cjs': [
                    "const { invoke } = require('@tauri-apps/api/core');",
                    '/** @type {{ runtimeOnly(): Promise<string> }} */',
                    "const runtime = { runtimeOnly: () => invoke('assign-clean-runtime') };",
                    "Object['assign'](exports, runtime);",
                ],
                'commonjs-assign-overwrite.cjs': [
                    'const leaked = {',
                    "    /** @param {import('@tauri-apps/api/core').InvokeArgs} args */",
                    '    overwritten(args) { return args; },',
                    '};',
                    "const clean = { overwritten() { return 'clean'; } };",
                    'Object.assign(exports, leaked, clean);',
                ],
                'commonjs-assign-replaced.cjs': [
                    'const source = {',
                    "    /** @param {import('@tauri-apps/api/core').InvokeArgs} args */",
                    '    replaced(args) { return args; },',
                    '};',
                    'Object.assign(module.exports, source);',
                    "module.exports = { replaced() { return 'clean'; } };",
                ],
                'commonjs-element-module-string.cjs': [
                    'const api = {',
                    "    /** @param {import('@tauri-apps/api/core').InvokeArgs} args */",
                    '    elementModuleString(args) { return args; },',
                    '};',
                    "module['exports'] = api;",
                ],
                'commonjs-element-module-template.cjs': [
                    'const api = {',
                    "    /** @param {import('@tauri-apps/api/core').InvokeArgs} args */",
                    '    elementModuleTemplate(args) { return args; },',
                    '};',
                    'module[`exports`] = api;',
                ],
                'commonjs-element-assign.cjs': [
                    'const exportsApi = {',
                    "    /** @param {import('@tauri-apps/api/core').InvokeArgs} args */",
                    '    elementAssignExports(args) { return args; },',
                    '};',
                    'const moduleApi = {',
                    "    /** @returns {import('@tauri-apps/api/core').InvokeArgs} */",
                    '    elementAssignModule() { return null; },',
                    '};',
                    "Object['assign'](exports, exportsApi);",
                    'Object[`assign`](module[`exports`], moduleApi);',
                ],
                'commonjs-element-named.cjs': [
                    'const api = {',
                    "    /** @param {import('@tauri-apps/api/core').InvokeArgs} args */",
                    '    namedString(args) { return args; },',
                    "    /** @returns {import('@tauri-apps/api/core').InvokeArgs} */",
                    '    namedTemplate() { return null; },',
                    '};',
                    "exports['namedString'] = api.namedString;",
                    'module[`exports`][`namedTemplate`] = api.namedTemplate;',
                ],
                'commonjs-element-dynamic.cjs': [
                    "const moduleKey = Math.random() > 0.5 ? 'exports' : 'other';",
                    "const assignKey = Math.random() > 0.5 ? 'assign' : 'other';",
                    "const exportKey = Math.random() > 0.5 ? 'invented' : 'other';",
                    'const api = {',
                    "    /** @param {import('@tauri-apps/api/core').InvokeArgs} args */",
                    '    invented(args) { return args; },',
                    '};',
                    'module[moduleKey] = api;',
                    'Object[assignKey](exports, api);',
                    'exports[exportKey] = api.invented;',
                ],
                'commonjs-element-shadowed-module.cjs': [
                    'const api = {',
                    "    /** @param {import('@tauri-apps/api/core').InvokeArgs} args */",
                    '    shadowedModule(args) { return args; },',
                    '};',
                    'function replace(module) {',
                    "    module['exports'] = api;",
                    '}',
                    'replace({ exports: {} });',
                ],
                'import-type-source.ts': [
                    "export type Leaked = import('@tauri-apps/api/core').InvokeArgs;",
                    'export type Clean = string;',
                    'export namespace Api {',
                    "    export type Leaked = import('@tauri-apps/api/core').InvokeArgs;",
                    '}',
                ],
            });
            writeFixtureFiles(useCaseDirectory, {
                'consume-adversarial-types.ts': [
                    "import { runtimeString, runtimePromise, runtimeFunction } from '../repositories/runtime-only';",
                    "import { runtimeFactory } from '../repositories/factory-runtime';",
                    '',
                    "const { directMethod, directGetter, spreadMethod } = require('../repositories/commonjs-surface');",
                    "const { hiddenMethod } = require('../repositories/commonjs-fallback');",
                    "const { unknownMethod } = require('../repositories/commonjs-partial');",
                    "const { unknownClean } = require('../repositories/commonjs-clean-runtime');",
                    "const { exposed } = require('../repositories/commonjs-assign-exports');",
                    "const { computedExposed } = require('../repositories/commonjs-assign-module');",
                    "const { dynamicLeak } = require('../repositories/commonjs-assign-dynamic');",
                    "const { shadowed } = require('../repositories/commonjs-assign-shadowed');",
                    "const { runtimeOnly } = require('../repositories/commonjs-assign-clean-runtime');",
                    "const { overwritten } = require('../repositories/commonjs-assign-overwrite');",
                    "const { replaced } = require('../repositories/commonjs-assign-replaced');",
                    "const { elementModuleString } = require('../repositories/commonjs-element-module-string');",
                    "const { elementModuleTemplate } = require('../repositories/commonjs-element-module-template');",
                    "const { elementAssignExports, elementAssignModule } = require('../repositories/commonjs-element-assign');",
                    "const namedString = require('../repositories/commonjs-element-named')['namedString'];",
                    "const namedTemplate = require('../repositories/commonjs-element-named')[`namedTemplate`];",
                    "const { invented, exportKey } = require('../repositories/commonjs-element-dynamic');",
                    "const { shadowedModule } = require('../repositories/commonjs-element-shadowed-module');",
                    '',
                    "export type ExternalMember = import('../repositories/import-type-source').Leaked;",
                    "export type ExternalQualified = import('../repositories/import-type-source').Api.Leaked;",
                    "export type ExternalWhole = typeof import('../repositories/import-type-source');",
                    "export const load = () => import('../repositories/import-type-source');",
                    '',
                    'void runtimeString;',
                    'void runtimePromise;',
                    'void runtimeFunction;',
                    'void runtimeFactory;',
                    'void directMethod;',
                    'void directGetter;',
                    'void spreadMethod;',
                    'void hiddenMethod;',
                    'void unknownMethod;',
                    'void unknownClean;',
                    'void exposed;',
                    'void computedExposed;',
                    'void dynamicLeak;',
                    'void shadowed;',
                    'void runtimeOnly;',
                    'void overwritten;',
                    'void replaced;',
                    'void elementModuleString;',
                    'void elementModuleTemplate;',
                    'void elementAssignExports;',
                    'void elementAssignModule;',
                    'void namedString;',
                    'void namedTemplate;',
                    'void invented;',
                    'void exportKey;',
                    'void shadowedModule;',
                ],
            });

            const findings = invokeStaticGuardFindings(repositoryRoot);
            const vendorFindings = findings.filter(({ reason }) => reason.includes('Tauri vendor type'));
            const unsupportedCommonJsFindings = findings.filter(
                ({ reason }) => reason === 'unsupported CommonJS public-surface mutation cannot be statically inspected'
            );

            expect(vendorFindings).toEqual(
                expect.arrayContaining([
                    vendorFinding('src/modules/Foo/repositories/commonjs-surface.cjs', 5),
                    vendorFinding('src/modules/Foo/repositories/commonjs-fallback.cjs', 5),
                    vendorFinding('src/modules/Foo/repositories/commonjs-partial.cjs', 1),
                    vendorFinding('src/modules/Foo/repositories/commonjs-assign-exports.cjs', 5),
                    vendorFinding('src/modules/Foo/repositories/commonjs-assign-module.cjs', 7),
                    vendorFinding('src/modules/Foo/repositories/commonjs-element-module-string.cjs', 5),
                    vendorFinding('src/modules/Foo/repositories/commonjs-element-module-template.cjs', 5),
                    vendorFinding('src/modules/Foo/repositories/commonjs-element-assign.cjs', 9),
                    vendorFinding('src/modules/Foo/repositories/commonjs-element-assign.cjs', 10),
                    vendorFinding('src/modules/Foo/repositories/commonjs-element-named.cjs', 7),
                    vendorFinding('src/modules/Foo/repositories/commonjs-element-named.cjs', 8),
                    vendorFinding('src/modules/Foo/repositories/import-type-source.ts', 1),
                    vendorFinding('src/modules/Foo/repositories/import-type-source.ts', 3),
                ])
            );
            expect(vendorFindings).not.toEqual(
                expect.arrayContaining([
                    vendorFinding('src/modules/Foo/repositories/runtime-only.ts', 3),
                    vendorFinding('src/modules/Foo/repositories/runtime-only.ts', 4),
                    vendorFinding('src/modules/Foo/repositories/runtime-only.ts', 5),
                    vendorFinding('src/modules/Foo/repositories/factory-runtime.ts', 3),
                    vendorFinding('src/modules/Foo/repositories/commonjs-clean-runtime.cjs', 4),
                    vendorFinding('src/modules/Foo/repositories/commonjs-assign-dynamic.cjs', 8),
                    vendorFinding('src/modules/Foo/repositories/commonjs-assign-shadowed.cjs', 2),
                    vendorFinding('src/modules/Foo/repositories/commonjs-assign-clean-runtime.cjs', 4),
                    vendorFinding('src/modules/Foo/repositories/commonjs-assign-overwrite.cjs', 6),
                    vendorFinding('src/modules/Foo/repositories/commonjs-assign-replaced.cjs', 5),
                    vendorFinding('src/modules/Foo/repositories/commonjs-element-dynamic.cjs', 8),
                    vendorFinding('src/modules/Foo/repositories/commonjs-element-dynamic.cjs', 9),
                    vendorFinding('src/modules/Foo/repositories/commonjs-element-dynamic.cjs', 10),
                    vendorFinding('src/modules/Foo/repositories/commonjs-element-shadowed-module.cjs', 6),
                ])
            );
            expect(vendorFindings).toHaveLength(13);
            expect(unsupportedCommonJsFindings).toEqual([
                unsupportedCommonJsFinding('src/modules/Foo/repositories/commonjs-assign-dynamic.cjs', 8),
                unsupportedCommonJsFinding('src/modules/Foo/repositories/commonjs-element-dynamic.cjs', 10),
            ]);
            expect(findings).toHaveLength(15);
        } finally {
            if (repositoryRoot) {
                rmSync(repositoryRoot, { force: true, recursive: true });
            }
        }
    });

    it('should model CommonJS export-object identity across aliases and rebinding', () => {
        let repositoryRoot: string | undefined;

        try {
            repositoryRoot = mkdtempSync(join(tmpdir(), 'check-dependency-boundaries-cjs-identity-'));
            const moduleDirectory = join(repositoryRoot, 'src/modules/Foo');
            const repositoryDirectory = join(moduleDirectory, 'repositories');
            const useCaseDirectory = join(moduleDirectory, 'useCases');
            const vendorDirectory = join(repositoryRoot, 'node_modules/@tauri-apps/api');
            mkdirSync(repositoryDirectory, { recursive: true });
            mkdirSync(useCaseDirectory, { recursive: true });
            mkdirSync(vendorDirectory, { recursive: true });

            writeFixtureFiles(repositoryRoot, {
                'package.json': JSON.stringify({ type: 'module' }),
                'src/globals.d.ts': [
                    'declare const module: { exports: Record<string, unknown> };',
                    'declare let exports: Record<string, unknown>;',
                ],
            });
            writeFixtureFiles(vendorDirectory, {
                'package.json': JSON.stringify({
                    name: '@tauri-apps/api',
                    type: 'module',
                    exports: {
                        './core': {
                            types: './core.d.ts',
                            default: './core.js',
                        },
                    },
                }),
                'core.js': 'export const invoke = null;\n',
                'core.d.ts': 'export type InvokeArgs = { command: string };\n',
            });
            writeFixtureFiles(repositoryDirectory, {
                'commonjs-alias-flow.cjs': [
                    "/** @type {import('@tauri-apps/api/core').InvokeArgs} */",
                    "const leaked = { command: 'alias-flow' };",
                    'const exportsAlias = exports;',
                    'const moduleAlias = module.exports;',
                    'exportsAlias.beforeExports = leaked;',
                    'moduleAlias.beforeModule = leaked;',
                    'let delayedExports;',
                    'delayedExports = exports;',
                    'delayedExports.afterDelayedExports = leaked;',
                    'exports = {};',
                    'exports.detachedExports = leaked;',
                    'moduleAlias.afterExportsRebindAlias = leaked;',
                    'const currentModule = module.exports;',
                    'currentModule.afterExportsRebindCurrent = leaked;',
                    'let delayedModule;',
                    'delayedModule = module.exports;',
                    'delayedModule.afterDelayedModule = leaked;',
                ],
                'commonjs-module-rebind.cjs': [
                    "/** @type {import('@tauri-apps/api/core').InvokeArgs} */",
                    "const leaked = { command: 'module-rebind' };",
                    'const oldModule = module.exports;',
                    'module.exports = { clean: true };',
                    'oldModule.detachedModule = leaked;',
                    'exports.detachedExports = leaked;',
                    'const currentModule = module.exports;',
                    'currentModule.afterModuleRebind = leaked;',
                ],
                'commonjs-clean-detached.cjs': [
                    "/** @type {import('@tauri-apps/api/core').InvokeArgs} */",
                    "const leaked = { command: 'clean-detached' };",
                    'const detached = {};',
                    'exports = detached;',
                    'exports.detachedExports = leaked;',
                    'module.exports = { clean: true };',
                    'detached.afterModuleRebind = leaked;',
                ],
            });
            writeFixtureFiles(useCaseDirectory, {
                'consume-cjs-identity.ts': [
                    "import { beforeExports, beforeModule, afterExportsRebindAlias, afterExportsRebindCurrent, afterDelayedExports, afterDelayedModule } from '../repositories/commonjs-alias-flow.cjs';",
                    "import { afterModuleRebind, detachedModule, detachedExports } from '../repositories/commonjs-module-rebind.cjs';",
                    "import { detachedExports as cleanDetached } from '../repositories/commonjs-clean-detached.cjs';",
                    'void beforeExports;',
                    'void beforeModule;',
                    'void afterExportsRebindAlias;',
                    'void afterExportsRebindCurrent;',
                    'void afterDelayedExports;',
                    'void afterDelayedModule;',
                    'void afterModuleRebind;',
                    'void detachedModule;',
                    'void detachedExports;',
                    'void cleanDetached;',
                ],
            });

            const vendorFindings = invokeStaticGuardFindings(repositoryRoot).filter(({ reason }) =>
                reason.includes('Tauri vendor type')
            );

            expect(vendorFindings).toEqual(
                expect.arrayContaining([
                    vendorFinding('src/modules/Foo/repositories/commonjs-alias-flow.cjs', 5),
                    vendorFinding('src/modules/Foo/repositories/commonjs-alias-flow.cjs', 6),
                    vendorFinding('src/modules/Foo/repositories/commonjs-alias-flow.cjs', 9),
                    vendorFinding('src/modules/Foo/repositories/commonjs-alias-flow.cjs', 12),
                    vendorFinding('src/modules/Foo/repositories/commonjs-alias-flow.cjs', 14),
                    vendorFinding('src/modules/Foo/repositories/commonjs-alias-flow.cjs', 17),
                    vendorFinding('src/modules/Foo/repositories/commonjs-module-rebind.cjs', 8),
                ])
            );
            expect(vendorFindings).toHaveLength(7);
            expect(vendorFindings).not.toEqual(
                expect.arrayContaining([
                    vendorFinding('src/modules/Foo/repositories/commonjs-alias-flow.cjs', 11),
                    vendorFinding('src/modules/Foo/repositories/commonjs-module-rebind.cjs', 5),
                    vendorFinding('src/modules/Foo/repositories/commonjs-module-rebind.cjs', 6),
                    vendorFinding('src/modules/Foo/repositories/commonjs-clean-detached.cjs', 5),
                    vendorFinding('src/modules/Foo/repositories/commonjs-clean-detached.cjs', 7),
                ])
            );
        } finally {
            if (repositoryRoot) {
                rmSync(repositoryRoot, { force: true, recursive: true });
            }
        }
    });

    it('should execute ordered CommonJS assignment chains and certain IIFEs', () => {
        let repositoryRoot: string | undefined;

        try {
            repositoryRoot = mkdtempSync(join(tmpdir(), 'check-dependency-boundaries-cjs-execution-'));
            const moduleDirectory = join(repositoryRoot, 'src/modules/Foo');
            const repositoryDirectory = join(moduleDirectory, 'repositories');
            const useCaseDirectory = join(moduleDirectory, 'useCases');
            const vendorDirectory = join(repositoryRoot, 'node_modules/@tauri-apps/api');
            mkdirSync(repositoryDirectory, { recursive: true });
            mkdirSync(useCaseDirectory, { recursive: true });
            mkdirSync(vendorDirectory, { recursive: true });

            writeFixtureFiles(repositoryRoot, {
                'package.json': JSON.stringify({ type: 'module' }),
                'src/globals.d.ts': [
                    'declare let module: { exports: Record<string, unknown> };',
                    'declare let exports: Record<string, unknown>;',
                    'declare let require: (moduleName: string) => any;',
                ],
            });
            writeFixtureFiles(vendorDirectory, {
                'package.json': JSON.stringify({
                    name: '@tauri-apps/api',
                    type: 'module',
                    exports: {
                        './core': {
                            types: './core.d.ts',
                            default: './core.js',
                        },
                    },
                }),
                'core.js': 'export const invoke = null;\n',
                'core.d.ts': 'export type InvokeArgs = { command: string };\n',
            });
            writeFixtureFiles(repositoryDirectory, {
                'ordered-chain-exports.cjs': [
                    "/** @type {import('@tauri-apps/api/core').InvokeArgs} */",
                    "const chained = { command: 'exports-outer' };",
                    "/** @type {import('@tauri-apps/api/core').InvokeArgs} */",
                    "const later = { command: 'exports-after-chain' };",
                    'exports = module.exports = { chained };',
                    'exports.afterChain = later;',
                ],
                'ordered-chain-module.cjs': [
                    "/** @type {import('@tauri-apps/api/core').InvokeArgs} */",
                    "const chained = { command: 'module-outer' };",
                    "/** @type {import('@tauri-apps/api/core').InvokeArgs} */",
                    "const later = { command: 'module-after-chain' };",
                    'module.exports = exports = { chained };',
                    'exports.afterChain = later;',
                ],
                'arrow-iife.cjs': [
                    "/** @type {import('@tauri-apps/api/core').InvokeArgs} */",
                    "const leaked = { command: 'arrow-iife' };",
                    '(() => {',
                    '    module.exports = { arrowIife: leaked };',
                    '})();',
                ],
                'function-iife.cjs': [
                    "/** @type {import('@tauri-apps/api/core').InvokeArgs} */",
                    "const leaked = { command: 'function-iife' };",
                    '(function () {',
                    '    module.exports.functionIife = leaked;',
                    '})();',
                ],
                'object-assign-alias.cjs': [
                    "/** @type {import('@tauri-apps/api/core').InvokeArgs} */",
                    "const leaked = { command: 'object-assign-alias' };",
                    'const assign = Object.assign;',
                    'assign(module.exports, { assignedAlias: leaked });',
                ],
                'object-assign-detached.cjs': [
                    "/** @type {import('@tauri-apps/api/core').InvokeArgs} */",
                    "const leaked = { command: 'object-assign-detached' };",
                    'let assign = Object.assign;',
                    'assign = () => ({ clean: true });',
                    'assign(module.exports, { detachedAssign: leaked });',
                ],
                'not-executed.cjs': [
                    "/** @type {import('@tauri-apps/api/core').InvokeArgs} */",
                    "const leaked = { command: 'not-executed' };",
                    'const later = () => {',
                    '    module.exports = { notExecuted: leaked };',
                    '};',
                    'function alsoLater() {',
                    '    module.exports.alsoNotExecuted = leaked;',
                    '}',
                    'void later;',
                    'void alsoLater;',
                ],
                'shadowed-iife.cjs': [
                    "/** @type {import('@tauri-apps/api/core').InvokeArgs} */",
                    "const leaked = { command: 'shadowed-iife' };",
                    '((module, exports) => {',
                    '    module.exports = { shadowedModule: leaked };',
                    '    exports.shadowedExports = leaked;',
                    '})({ exports: {} }, {});',
                ],
            });
            writeFixtureFiles(useCaseDirectory, {
                'consume-certain-execution.ts': [
                    "const orderedExports = require('../repositories/ordered-chain-exports.cjs');",
                    "const orderedModule = require('../repositories/ordered-chain-module.cjs');",
                    "const arrowIife = require('../repositories/arrow-iife.cjs');",
                    "const functionIife = require('../repositories/function-iife.cjs');",
                    "const assignedAlias = require('../repositories/object-assign-alias.cjs');",
                    "const detachedAssign = require('../repositories/object-assign-detached.cjs');",
                    "const notExecuted = require('../repositories/not-executed.cjs');",
                    "const shadowedIife = require('../repositories/shadowed-iife.cjs');",
                    'void orderedExports;',
                    'void orderedModule;',
                    'void arrowIife;',
                    'void functionIife;',
                    'void assignedAlias;',
                    'void detachedAssign;',
                    'void notExecuted;',
                    'void shadowedIife;',
                    'export {};',
                ],
            });

            const vendorFindings = invokeStaticGuardFindings(repositoryRoot).filter(({ reason }) =>
                reason.includes('Tauri vendor type')
            );

            expect(vendorFindings).toEqual(
                expect.arrayContaining([
                    vendorFinding('src/modules/Foo/repositories/ordered-chain-exports.cjs', 5),
                    vendorFinding('src/modules/Foo/repositories/ordered-chain-exports.cjs', 6),
                    vendorFinding('src/modules/Foo/repositories/ordered-chain-module.cjs', 5),
                    vendorFinding('src/modules/Foo/repositories/ordered-chain-module.cjs', 6),
                    vendorFinding('src/modules/Foo/repositories/arrow-iife.cjs', 4),
                    vendorFinding('src/modules/Foo/repositories/function-iife.cjs', 4),
                    vendorFinding('src/modules/Foo/repositories/object-assign-alias.cjs', 4),
                ])
            );
            expect(vendorFindings).toHaveLength(7);
        } finally {
            if (repositoryRoot) {
                rmSync(repositoryRoot, { force: true, recursive: true });
            }
        }
    });

    it('should track the CommonJS module object through aliases and detachment', () => {
        let repositoryRoot: string | undefined;

        try {
            repositoryRoot = mkdtempSync(join(tmpdir(), 'check-dependency-boundaries-module-identity-'));
            const moduleDirectory = join(repositoryRoot, 'src/modules/Foo');
            const repositoryDirectory = join(moduleDirectory, 'repositories');
            const useCaseDirectory = join(moduleDirectory, 'useCases');
            const vendorDirectory = join(repositoryRoot, 'node_modules/@tauri-apps/api');
            mkdirSync(repositoryDirectory, { recursive: true });
            mkdirSync(useCaseDirectory, { recursive: true });
            mkdirSync(vendorDirectory, { recursive: true });

            writeFixtureFiles(repositoryRoot, {
                'package.json': JSON.stringify({ type: 'module' }),
                'src/globals.d.ts': [
                    'declare let module: { exports: Record<string, unknown> };',
                    'declare let exports: Record<string, unknown>;',
                    'declare let require: (moduleName: string) => any;',
                ],
            });
            writeFixtureFiles(vendorDirectory, {
                'package.json': JSON.stringify({
                    name: '@tauri-apps/api',
                    type: 'module',
                    exports: {
                        './core': {
                            types: './core.d.ts',
                            default: './core.js',
                        },
                    },
                }),
                'core.js': 'export const invoke = null;\n',
                'core.d.ts': 'export type InvokeArgs = { command: string };\n',
            });
            writeFixtureFiles(repositoryDirectory, {
                'module-object-alias.cjs': [
                    "/** @type {import('@tauri-apps/api/core').InvokeArgs} */",
                    "const leaked = { command: 'module-object-alias' };",
                    'const m = module;',
                    "m['exports'] = { wholeAlias: leaked };",
                    'm.exports.elementAlias = leaked;',
                    'const chained = m;',
                    'chained.exports.chainedAlias = leaked;',
                    'let moving = module;',
                    'moving.exports.beforeDetach = leaked;',
                    'moving = { exports: {} };',
                    'moving.exports.afterDetach = leaked;',
                    'let delayed;',
                    'delayed = module;',
                    "delayed['exports'].delayedAlias = leaked;",
                    'delayed = { exports: {} };',
                    "delayed['exports'] = { detachedWhole: leaked };",
                ],
                'shadowed-module-alias.cjs': [
                    "/** @type {import('@tauri-apps/api/core').InvokeArgs} */",
                    "const leaked = { command: 'shadowed-module-alias' };",
                    '((module) => {',
                    '    const m = module;',
                    '    m.exports = { shadowedAlias: leaked };',
                    '})({ exports: {} });',
                    'module.exports = { clean: true };',
                ],
            });
            writeFixtureFiles(useCaseDirectory, {
                'consume-module-object.ts': [
                    "const moduleObject = require('../repositories/module-object-alias.cjs');",
                    "const shadowedModule = require('../repositories/shadowed-module-alias.cjs');",
                    'void moduleObject;',
                    'void shadowedModule;',
                    'export {};',
                ],
            });

            const vendorFindings = invokeStaticGuardFindings(repositoryRoot).filter(({ reason }) =>
                reason.includes('Tauri vendor type')
            );

            expect(vendorFindings).toEqual(
                expect.arrayContaining([
                    vendorFinding('src/modules/Foo/repositories/module-object-alias.cjs', 4),
                    vendorFinding('src/modules/Foo/repositories/module-object-alias.cjs', 5),
                    vendorFinding('src/modules/Foo/repositories/module-object-alias.cjs', 7),
                    vendorFinding('src/modules/Foo/repositories/module-object-alias.cjs', 9),
                    vendorFinding('src/modules/Foo/repositories/module-object-alias.cjs', 14),
                ])
            );
            expect(vendorFindings).toHaveLength(5);
        } finally {
            if (repositoryRoot) {
                rmSync(repositoryRoot, { force: true, recursive: true });
            }
        }
    });

    it('should resolve require identities through aliases, rebinding, and certain IIFEs', () => {
        let repositoryRoot: string | undefined;

        try {
            repositoryRoot = mkdtempSync(join(tmpdir(), 'check-dependency-boundaries-require-identity-'));
            const moduleDirectory = join(repositoryRoot, 'src/modules/Foo');
            const repositoryDirectory = join(moduleDirectory, 'repositories');
            const useCaseDirectory = join(moduleDirectory, 'useCases');
            const vendorDirectory = join(repositoryRoot, 'node_modules/@tauri-apps/api');
            const requireAliasDepth = 600;
            mkdirSync(repositoryDirectory, { recursive: true });
            mkdirSync(useCaseDirectory, { recursive: true });
            mkdirSync(vendorDirectory, { recursive: true });

            writeFixtureFiles(repositoryRoot, {
                'package.json': JSON.stringify({ type: 'module' }),
                'src/globals.d.ts': [
                    'declare let module: { exports: Record<string, unknown> };',
                    'declare let exports: Record<string, unknown>;',
                    'declare let require: (moduleName: string) => any;',
                ],
            });
            writeFixtureFiles(vendorDirectory, {
                'package.json': JSON.stringify({
                    name: '@tauri-apps/api',
                    type: 'module',
                    exports: {
                        './core': {
                            types: './core.d.ts',
                            default: './core.js',
                        },
                    },
                }),
                'core.js': 'export const invoke = null;\n',
                'core.d.ts': 'export type InvokeArgs = { command: string };\n',
            });

            const typedSurface = (name: string): readonly string[] => [
                "/** @type {import('@tauri-apps/api/core').InvokeArgs} */",
                `const ${name} = { command: '${name}' };`,
                `module.exports = { ${name} };`,
            ];
            writeFixtureFiles(repositoryDirectory, {
                'alias-positive.cjs': typedSurface('aliasPositive'),
                'alias-chain.cjs': typedSurface('aliasChain'),
                'before-rebind.cjs': typedSurface('beforeRebind'),
                'after-rebind.cjs': typedSurface('afterRebind'),
                'direct-before.cjs': typedSurface('directBefore'),
                'direct-after.cjs': typedSurface('directAfter'),
                'iife-consumer.cjs': typedSurface('iifeConsumer'),
                'noninvoked-consumer.cjs': typedSurface('noninvokedConsumer'),
                'shadowed-consumer.cjs': typedSurface('shadowedConsumer'),
                'long-alias.cjs': typedSurface('longAlias'),
                'vendor-alias.cjs': [
                    'const load = require;',
                    "const vendor = load('@tauri-apps/api/core');",
                    'module.exports = { vendor };',
                ],
                'vendor-detached.cjs': [
                    'let load = require;',
                    'load = () => ({ clean: true });',
                    "const vendor = load('@tauri-apps/api/core');",
                    'module.exports = { vendor };',
                ],
                'vendor-iife.cjs': [
                    '(() => {',
                    '    const load = require;',
                    "    module.exports = { vendorIife: load('@tauri-apps/api/core') };",
                    '})();',
                ],
            });

            const longAliasConsumer = ['const load0000 = require;'];
            for (let index = 1; index < requireAliasDepth; index += 1) {
                const current = String(index).padStart(4, '0');
                const previous = String(index - 1).padStart(4, '0');
                longAliasConsumer.push(`const load${current} = load${previous};`);
            }
            longAliasConsumer.push(
                `const longAlias = load${String(requireAliasDepth - 1).padStart(
                    4,
                    '0'
                )}('../repositories/long-alias.cjs');`,
                'void longAlias;',
                'export {};'
            );

            writeFixtureFiles(useCaseDirectory, {
                'consume-alias-positive.ts': [
                    'const load = require;',
                    "const aliasPositive = load('../repositories/alias-positive.cjs');",
                    'void aliasPositive;',
                    'export {};',
                ],
                'consume-alias-chain.ts': [
                    'const load = require;',
                    'const again = load;',
                    "const aliasChain = again('../repositories/alias-chain.cjs');",
                    'void aliasChain;',
                    'export {};',
                ],
                'consume-before-rebind.ts': [
                    'let load = require;',
                    "const beforeRebind = load('../repositories/before-rebind.cjs');",
                    'load = () => ({ clean: true });',
                    'void beforeRebind;',
                    'export {};',
                ],
                'consume-after-rebind.ts': [
                    'let load = require;',
                    'load = () => ({ clean: true });',
                    "const afterRebind = load('../repositories/after-rebind.cjs');",
                    'void afterRebind;',
                    'export {};',
                ],
                'consume-direct-order.ts': [
                    "const directBefore = require('../repositories/direct-before.cjs');",
                    'require = () => ({ clean: true });',
                    "const directAfter = require('../repositories/direct-after.cjs');",
                    'void directBefore;',
                    'void directAfter;',
                    'export {};',
                ],
                'consume-iife.ts': [
                    '(() => {',
                    '    const load = require;',
                    "    const iifeConsumer = load('../repositories/iife-consumer.cjs');",
                    '    void iifeConsumer;',
                    '})();',
                    'export {};',
                ],
                'consume-noninvoked.ts': [
                    'const later = () => {',
                    "    const noninvoked = require('../repositories/noninvoked-consumer.cjs');",
                    '    return noninvoked;',
                    '};',
                    'void later;',
                    'export {};',
                ],
                'consume-shadowed.ts': [
                    '((require) => {',
                    '    const load = require;',
                    "    const shadowed = load('../repositories/shadowed-consumer.cjs');",
                    '    void shadowed;',
                    '})(() => ({ clean: true }));',
                    'export {};',
                ],
                'consume-long-alias.ts': longAliasConsumer,
                'consume-vendor-require.ts': [
                    "const vendorAlias = require('../repositories/vendor-alias.cjs');",
                    "const vendorDetached = require('../repositories/vendor-detached.cjs');",
                    "const vendorIife = require('../repositories/vendor-iife.cjs');",
                    'void vendorAlias;',
                    'void vendorDetached;',
                    'void vendorIife;',
                    'export {};',
                ],
            });

            const startedAt = performance.now();
            const vendorFindings = invokeStaticGuardFindings(repositoryRoot).filter(({ reason }) =>
                reason.includes('Tauri vendor type')
            );
            const elapsedMs = performance.now() - startedAt;

            expect(vendorFindings).toEqual(
                expect.arrayContaining([
                    vendorFinding('src/modules/Foo/repositories/alias-positive.cjs', 3),
                    vendorFinding('src/modules/Foo/repositories/alias-chain.cjs', 3),
                    vendorFinding('src/modules/Foo/repositories/before-rebind.cjs', 3),
                    vendorFinding('src/modules/Foo/repositories/direct-before.cjs', 3),
                    vendorFinding('src/modules/Foo/repositories/iife-consumer.cjs', 3),
                    vendorFinding('src/modules/Foo/repositories/long-alias.cjs', 3),
                    vendorFinding('src/modules/Foo/repositories/vendor-alias.cjs', 3),
                    vendorFinding('src/modules/Foo/repositories/vendor-iife.cjs', 3),
                ])
            );
            expect(vendorFindings).toHaveLength(8);
            expect(elapsedMs).toBeLessThan(10_000);
        } finally {
            if (repositoryRoot) {
                rmSync(repositoryRoot, { force: true, recursive: true });
            }
        }
    }, 20_000);

    it('should resolve require only through the live CommonJS module object', () => {
        const { repositoryDirectory, repositoryRoot, useCaseDirectory } = createCommonJsStaticGuardFixture(
            'check-dependency-boundaries-module-require-'
        );

        try {
            const moduleAliasDepth = 100;
            const typedSurface = (name: string): readonly string[] => [
                "/** @type {import('@tauri-apps/api/core').InvokeArgs} */",
                `const ${name} = { command: '${name}' };`,
                `module.exports = { ${name} };`,
            ];
            writeFixtureFiles(repositoryDirectory, {
                'direct.cjs': typedSurface('direct'),
                'element.cjs': typedSurface('element'),
                'computed.cjs': typedSurface('computed'),
                'module-alias.cjs': typedSurface('moduleAlias'),
                'destructured.cjs': typedSurface('destructured'),
                'computed-destructured.cjs': typedSurface('computedDestructured'),
                'assigned-destructured.cjs': typedSurface('assignedDestructured'),
                'iife.cjs': typedSurface('iife'),
                'captured-before-rebind.cjs': typedSurface('capturedBeforeRebind'),
                'before-property-rebind.cjs': typedSurface('beforePropertyRebind'),
                'after-property-rebind.cjs': typedSurface('afterPropertyRebind'),
                'live-object-after-module-rebind.cjs': typedSurface('liveObjectAfterModuleRebind'),
                'rebound-module.cjs': typedSurface('reboundModule'),
                'property-rebound-through-alias.cjs': typedSurface('propertyReboundThroughAlias'),
                'shadowed-module.cjs': typedSurface('shadowedModule'),
                'noninvoked.cjs': typedSurface('noninvoked'),
                'dynamic-property.cjs': typedSurface('dynamicProperty'),
                'reassigned-destructured.cjs': typedSurface('reassignedDestructured'),
                'long-module-alias.cjs': typedSurface('longModuleAlias'),
                'vendor-live.cjs': [
                    "const vendor = module.require('@tauri-apps/api/core');",
                    'module.exports = { vendor };',
                ],
                'vendor-element.cjs': [
                    "const vendor = module['require']('@tauri-apps/api/core');",
                    'module.exports = { vendor };',
                ],
                'vendor-rebound.cjs': [
                    'module.require = () => ({ clean: true });',
                    "const vendor = module.require('@tauri-apps/api/core');",
                    'module.exports = { vendor };',
                ],
                'vendor-shadowed.cjs': [
                    '((module) => {',
                    "    module.exports = { vendor: module.require('@tauri-apps/api/core') };",
                    '})({ exports: {}, require: () => ({ clean: true }) });',
                ],
            });
            const longModuleAliasConsumer = ['const module0000 = module;'];
            for (let index = 1; index < moduleAliasDepth; index += 1) {
                const current = String(index).padStart(4, '0');
                const previous = String(index - 1).padStart(4, '0');
                longModuleAliasConsumer.push(`const module${current} = module${previous};`);
            }
            longModuleAliasConsumer.push(
                `const longModuleAlias = module${String(moduleAliasDepth - 1).padStart(
                    4,
                    '0'
                )}.require('../repositories/long-module-alias.cjs');`,
                'void longModuleAlias;',
                'export {};'
            );
            writeFixtureFiles(useCaseDirectory, {
                'consume-live.ts': [
                    "const direct = module.require('../repositories/direct.cjs');",
                    "const element = module['require']('../repositories/element.cjs');",
                    "const requireKey = 'require';",
                    "const computed = module[requireKey]('../repositories/computed.cjs');",
                    'const liveModule = module;',
                    'const load = liveModule.require;',
                    "const moduleAlias = load('../repositories/module-alias.cjs');",
                    'const { require: destructuredLoad } = module;',
                    "const destructured = destructuredLoad('../repositories/destructured.cjs');",
                    "const destructuredKey = 'require';",
                    'const { [destructuredKey]: computedLoad } = module;',
                    "const computedDestructured = computedLoad('../repositories/computed-destructured.cjs');",
                    'let assignedLoad;',
                    '({ require: assignedLoad } = module);',
                    "const assignedDestructured = assignedLoad('../repositories/assigned-destructured.cjs');",
                    '(() => {',
                    "    const iife = module.require('../repositories/iife.cjs');",
                    '    void iife;',
                    '})();',
                    "const vendorLive = require('../repositories/vendor-live.cjs');",
                    "const vendorElement = require('../repositories/vendor-element.cjs');",
                    'void direct;',
                    'void element;',
                    'void computed;',
                    'void moduleAlias;',
                    'void destructured;',
                    'void computedDestructured;',
                    'void assignedDestructured;',
                    'void vendorLive;',
                    'void vendorElement;',
                    'export {};',
                ],
                'consume-property-order.ts': [
                    'const captured = module.require;',
                    "const before = module.require('../repositories/before-property-rebind.cjs');",
                    "module['require'] = () => ({ clean: true });",
                    "const capturedBeforeRebind = captured('../repositories/captured-before-rebind.cjs');",
                    "const after = module.require('../repositories/after-property-rebind.cjs');",
                    'void before;',
                    'void capturedBeforeRebind;',
                    'void after;',
                    'export {};',
                ],
                'consume-module-order.ts': [
                    'const actualModule = module;',
                    'module = { exports: {}, require: () => ({ clean: true }) };',
                    "const liveObject = actualModule.require('../repositories/live-object-after-module-rebind.cjs');",
                    "const rebound = module.require('../repositories/rebound-module.cjs');",
                    'void liveObject;',
                    'void rebound;',
                    'export {};',
                ],
                'consume-negative.ts': [
                    'const actualModule = module;',
                    'actualModule.require = () => ({ clean: true });',
                    "const aliasRebound = module.require('../repositories/property-rebound-through-alias.cjs');",
                    '((module) => {',
                    "    const shadowed = module.require('../repositories/shadowed-module.cjs');",
                    '    void shadowed;',
                    '})({ exports: {}, require: () => ({ clean: true }) });',
                    "const later = () => module.require('../repositories/noninvoked.cjs');",
                    "const dynamicKey = Math.random() > 0.5 ? 'require' : 'other';",
                    "const dynamic = module[dynamicKey]('../repositories/dynamic-property.cjs');",
                    'let { require: reassignedLoad } = module;',
                    'reassignedLoad = () => ({ clean: true });',
                    "const reassigned = reassignedLoad('../repositories/reassigned-destructured.cjs');",
                    "const vendorRebound = require('../repositories/vendor-rebound.cjs');",
                    "const vendorShadowed = require('../repositories/vendor-shadowed.cjs');",
                    'void aliasRebound;',
                    'void later;',
                    'void dynamic;',
                    'void reassigned;',
                    'void vendorRebound;',
                    'void vendorShadowed;',
                    'export {};',
                ],
                'consume-long-module-alias.ts': longModuleAliasConsumer,
            });

            const startedAt = performance.now();
            const vendorFindings = invokeStaticGuardFindings(repositoryRoot).filter(({ reason }) =>
                reason.includes('Tauri vendor type')
            );
            const elapsedMs = performance.now() - startedAt;

            expect(vendorFindings).toEqual(
                expect.arrayContaining([
                    vendorFinding('src/modules/Foo/repositories/direct.cjs', 3),
                    vendorFinding('src/modules/Foo/repositories/element.cjs', 3),
                    vendorFinding('src/modules/Foo/repositories/computed.cjs', 3),
                    vendorFinding('src/modules/Foo/repositories/module-alias.cjs', 3),
                    vendorFinding('src/modules/Foo/repositories/destructured.cjs', 3),
                    vendorFinding('src/modules/Foo/repositories/computed-destructured.cjs', 3),
                    vendorFinding('src/modules/Foo/repositories/assigned-destructured.cjs', 3),
                    vendorFinding('src/modules/Foo/repositories/iife.cjs', 3),
                    vendorFinding('src/modules/Foo/repositories/captured-before-rebind.cjs', 3),
                    vendorFinding('src/modules/Foo/repositories/before-property-rebind.cjs', 3),
                    vendorFinding('src/modules/Foo/repositories/live-object-after-module-rebind.cjs', 3),
                    vendorFinding('src/modules/Foo/repositories/long-module-alias.cjs', 3),
                    vendorFinding('src/modules/Foo/repositories/vendor-live.cjs', 2),
                    vendorFinding('src/modules/Foo/repositories/vendor-element.cjs', 2),
                ])
            );
            expect(vendorFindings).toHaveLength(14);
            expect(elapsedMs).toBeLessThan(10_000);
        } finally {
            rmSync(repositoryRoot, { force: true, recursive: true });
        }
    });

    it('should project tracked carrier members through binding and assignment patterns', () => {
        const { repositoryDirectory, repositoryRoot, useCaseDirectory } = createCommonJsStaticGuardFixture(
            'check-dependency-boundaries-carrier-patterns-'
        );

        try {
            writeFixtureFiles(repositoryDirectory, {
                'object-binding.cjs': [
                    "/** @type {import('@tauri-apps/api/core').InvokeArgs} */",
                    "const leaked = { command: 'object-binding' };",
                    'const { assign } = Object;',
                    'assign(exports, { objectBinding: leaked });',
                ],
                'object-computed-binding.cjs': [
                    "/** @type {import('@tauri-apps/api/core').InvokeArgs} */",
                    "const leaked = { command: 'object-computed-binding' };",
                    "const key = 'assign';",
                    'const { [key]: assign } = Object;',
                    'assign(exports, { objectComputedBinding: leaked });',
                ],
                'module-binding.cjs': [
                    "/** @type {import('@tauri-apps/api/core').InvokeArgs} */",
                    "const leaked = { command: 'module-binding' };",
                    'const { exports: out } = module;',
                    'out.moduleBinding = leaked;',
                ],
                'object-assignment-pattern.cjs': [
                    "/** @type {import('@tauri-apps/api/core').InvokeArgs} */",
                    "const leaked = { command: 'object-assignment-pattern' };",
                    'let assign;',
                    '({ assign } = Object);',
                    'assign(exports, { objectAssignmentPattern: leaked });',
                ],
                'module-assignment-pattern.cjs': [
                    "/** @type {import('@tauri-apps/api/core').InvokeArgs} */",
                    "const leaked = { command: 'module-assignment-pattern' };",
                    'let out;',
                    '({ exports: out } = module);',
                    'out.moduleAssignmentPattern = leaked;',
                ],
                'array-binding.cjs': [
                    "/** @type {import('@tauri-apps/api/core').InvokeArgs} */",
                    "const leaked = { command: 'array-binding' };",
                    'const [{ exports: out }] = [module];',
                    'out.arrayBinding = leaked;',
                ],
                'array-assignment-pattern.cjs': [
                    "/** @type {import('@tauri-apps/api/core').InvokeArgs} */",
                    "const leaked = { command: 'array-assignment-pattern' };",
                    'let out;',
                    '([{ exports: out }] = [module]);',
                    'out.arrayAssignmentPattern = leaked;',
                ],
                'module-computed-assignment.cjs': [
                    "/** @type {import('@tauri-apps/api/core').InvokeArgs} */",
                    "const leaked = { command: 'module-computed-assignment' };",
                    "const key = 'exports';",
                    'let out;',
                    '({ [key]: out } = module);',
                    'out.moduleComputedAssignment = leaked;',
                ],
                'detached-export-binding.cjs': [
                    "/** @type {import('@tauri-apps/api/core').InvokeArgs} */",
                    "const leaked = { command: 'detached-export-binding' };",
                    'const { exports: out } = module;',
                    'module.exports = { clean: true };',
                    'out.detachedExportBinding = leaked;',
                ],
                'rebound-assign.cjs': [
                    "/** @type {import('@tauri-apps/api/core').InvokeArgs} */",
                    "const leaked = { command: 'rebound-assign' };",
                    'let { assign } = Object;',
                    'assign = () => ({ clean: true });',
                    'assign(exports, { reboundAssign: leaked });',
                ],
                'dynamic-pattern.cjs': [
                    "/** @type {import('@tauri-apps/api/core').InvokeArgs} */",
                    "const leaked = { command: 'dynamic-pattern' };",
                    "const key = Math.random() > 0.5 ? 'exports' : 'other';",
                    'const { [key]: out } = module;',
                    'out.dynamicPattern = leaked;',
                ],
                'rest-pattern.cjs': [
                    "/** @type {import('@tauri-apps/api/core').InvokeArgs} */",
                    "const leaked = { command: 'rest-pattern' };",
                    'const { ...copy } = module;',
                    'copy.exports.restPattern = leaked;',
                ],
                'shadowed-carriers.cjs': [
                    "/** @type {import('@tauri-apps/api/core').InvokeArgs} */",
                    "const leaked = { command: 'shadowed-carriers' };",
                    '((Object, module) => {',
                    '    const { assign } = Object;',
                    '    const { exports: out } = module;',
                    '    assign(out, { shadowedCarriers: leaked });',
                    '})({ assign: () => ({}) }, { exports: {} });',
                    'module.exports = { clean: true };',
                ],
            });
            writeFixtureFiles(useCaseDirectory, {
                'consume-patterns.ts': [
                    "const objectBinding = require('../repositories/object-binding.cjs');",
                    "const objectComputed = require('../repositories/object-computed-binding.cjs');",
                    "const moduleBinding = require('../repositories/module-binding.cjs');",
                    "const objectAssignment = require('../repositories/object-assignment-pattern.cjs');",
                    "const moduleAssignment = require('../repositories/module-assignment-pattern.cjs');",
                    "const arrayBinding = require('../repositories/array-binding.cjs');",
                    "const arrayAssignment = require('../repositories/array-assignment-pattern.cjs');",
                    "const moduleComputed = require('../repositories/module-computed-assignment.cjs');",
                    "const detached = require('../repositories/detached-export-binding.cjs');",
                    "const rebound = require('../repositories/rebound-assign.cjs');",
                    "const dynamic = require('../repositories/dynamic-pattern.cjs');",
                    "const rest = require('../repositories/rest-pattern.cjs');",
                    "const shadowed = require('../repositories/shadowed-carriers.cjs');",
                    'void objectBinding;',
                    'void objectComputed;',
                    'void moduleBinding;',
                    'void objectAssignment;',
                    'void moduleAssignment;',
                    'void arrayBinding;',
                    'void arrayAssignment;',
                    'void moduleComputed;',
                    'void detached;',
                    'void rebound;',
                    'void dynamic;',
                    'void rest;',
                    'void shadowed;',
                    'export {};',
                ],
            });

            const vendorFindings = invokeStaticGuardFindings(repositoryRoot).filter(({ reason }) =>
                reason.includes('Tauri vendor type')
            );

            expect(vendorFindings).toEqual(
                expect.arrayContaining([
                    vendorFinding('src/modules/Foo/repositories/object-binding.cjs', 4),
                    vendorFinding('src/modules/Foo/repositories/object-computed-binding.cjs', 5),
                    vendorFinding('src/modules/Foo/repositories/module-binding.cjs', 4),
                    vendorFinding('src/modules/Foo/repositories/object-assignment-pattern.cjs', 5),
                    vendorFinding('src/modules/Foo/repositories/module-assignment-pattern.cjs', 5),
                    vendorFinding('src/modules/Foo/repositories/array-binding.cjs', 4),
                    vendorFinding('src/modules/Foo/repositories/array-assignment-pattern.cjs', 5),
                    vendorFinding('src/modules/Foo/repositories/module-computed-assignment.cjs', 6),
                ])
            );
            expect(vendorFindings).toHaveLength(8);
        } finally {
            rmSync(repositoryRoot, { force: true, recursive: true });
        }
    });

    it('should fail closed only for dynamic mutations of the live CommonJS export surface', () => {
        const { repositoryDirectory, repositoryRoot } = createCommonJsStaticGuardFixture(
            'check-dependency-boundaries-dynamic-commonjs-'
        );

        try {
            writeFixtureFiles(repositoryDirectory, {
                'dynamic-exports.cjs': [
                    "const key = Math.random() > 0.5 ? 'first' : 'second';",
                    'exports[key] = { clean: true };',
                ],
                'dynamic-alias.cjs': [
                    'const out = module.exports;',
                    "const key = Math.random() > 0.5 ? 'first' : 'second';",
                    'out[key] = { clean: true };',
                ],
                'dynamic-iife.cjs': [
                    "const key = Math.random() > 0.5 ? 'first' : 'second';",
                    '(() => {',
                    '    module.exports[key] = { clean: true };',
                    '})();',
                ],
                'dynamic-deduplicated.cjs': [
                    "const first = Math.random() > 0.5 ? 'first' : 'second';",
                    "const second = Math.random() > 0.5 ? 'third' : 'fourth';",
                    '(exports[first] = 1, exports[second] = 2);',
                ],
                'assign-unknown.cjs': ['Object.assign(exports, loadUnknown());'],
                'assign-unknown-alias.cjs': ['const out = module.exports;', 'Object.assign(out, unknownSource);'],
                'assign-dynamic-member.cjs': [
                    "const key = Math.random() > 0.5 ? 'first' : 'second';",
                    'Object.assign(module.exports, { [key]: true });',
                ],
                'assign-unknown-spread.cjs': ['Object.assign(exports, { ...loadUnknown() });'],
                'assign-multiple-unknown.cjs': ['Object.assign(exports, firstUnknown, secondUnknown);'],
                'computed-static.cjs': ["const key = 'known';", 'exports[key] = { clean: true };'],
                'detached-alias.cjs': [
                    'const out = module.exports;',
                    'module.exports = { clean: true };',
                    "const key = Math.random() > 0.5 ? 'first' : 'second';",
                    'out[key] = { detached: true };',
                ],
                'detached-exports.cjs': [
                    'module.exports = { clean: true };',
                    "const key = Math.random() > 0.5 ? 'first' : 'second';",
                    'exports[key] = { detached: true };',
                ],
                'assign-detached.cjs': [
                    'const out = module.exports;',
                    'module.exports = { clean: true };',
                    'Object.assign(out, unknownSource);',
                ],
                'assign-known.cjs': ['Object.assign(exports, { known: true });'],
                'assign-known-spread.cjs': ['const known = { known: true };', 'Object.assign(exports, { ...known });'],
                'logical-or.cjs': ['exports.logicalOr ||= loadUnknown();'],
                'logical-and.cjs': ['exports.logicalAnd = true;', 'exports.logicalAnd &&= loadUnknown();'],
                'logical-nullish-alias.cjs': ['const out = module.exports;', 'out.logicalNullish ??= loadUnknown();'],
                'unrelated-object.cjs': [
                    'const target = {};',
                    "const key = Math.random() > 0.5 ? 'first' : 'second';",
                    'target[key] = { clean: true };',
                    'Object.assign(target, unknownSource);',
                ],
                'dynamic-module-property.cjs': [
                    "const key = Math.random() > 0.5 ? 'exports' : 'other';",
                    'module[key] = { clean: true };',
                ],
                'noninvoked.cjs': [
                    "const key = Math.random() > 0.5 ? 'first' : 'second';",
                    'const later = () => {',
                    '    exports[key] = { clean: true };',
                    '};',
                    'void later;',
                ],
                'shadowed-exports.cjs': [
                    "const key = Math.random() > 0.5 ? 'first' : 'second';",
                    '((exports) => {',
                    '    exports[key] = { clean: true };',
                    '})({});',
                ],
            });

            const findings = invokeStaticGuardFindings(repositoryRoot);

            expect(findings).toEqual([
                unsupportedCommonJsFinding('src/modules/Foo/repositories/assign-dynamic-member.cjs', 2),
                unsupportedCommonJsFinding('src/modules/Foo/repositories/assign-multiple-unknown.cjs', 1),
                unsupportedCommonJsFinding('src/modules/Foo/repositories/assign-unknown-alias.cjs', 2),
                unsupportedCommonJsFinding('src/modules/Foo/repositories/assign-unknown-spread.cjs', 1),
                unsupportedCommonJsFinding('src/modules/Foo/repositories/assign-unknown.cjs', 1),
                unsupportedCommonJsFinding('src/modules/Foo/repositories/dynamic-alias.cjs', 3),
                unsupportedCommonJsFinding('src/modules/Foo/repositories/dynamic-deduplicated.cjs', 3),
                unsupportedCommonJsFinding('src/modules/Foo/repositories/dynamic-exports.cjs', 2),
                unsupportedCommonJsFinding('src/modules/Foo/repositories/dynamic-iife.cjs', 3),
                unsupportedCommonJsFinding('src/modules/Foo/repositories/logical-and.cjs', 2),
                unsupportedCommonJsFinding('src/modules/Foo/repositories/logical-nullish-alias.cjs', 2),
                unsupportedCommonJsFinding('src/modules/Foo/repositories/logical-or.cjs', 1),
            ]);
        } finally {
            rmSync(repositoryRoot, { force: true, recursive: true });
        }
    });

    it('should fail closed only for possible live CommonJS mutations in unsupported control flow', () => {
        const { repositoryDirectory, repositoryRoot } = createCommonJsStaticGuardFixture(
            'check-dependency-boundaries-commonjs-control-flow-'
        );

        try {
            const boundedControl = ['const unrelated = {};'];
            for (let index = 0; index < 300; index += 1) {
                boundedControl.push(`if (conditions[${index}]) { unrelated.value = ${index}; }`);
            }
            const boundedSwitch = ['switch (selector) {'];
            for (let index = 0; index < 300; index += 1) {
                boundedSwitch.push(`    case ${index}:`, `        unrelated.value = ${index};`, '        break;');
            }
            boundedSwitch.push('}');

            writeFixtureFiles(repositoryDirectory, {
                'if.cjs': ['if (condition) {', '    module.exports = { conditional: true };', '}'],
                'switch.cjs': [
                    'switch (selector) {',
                    "    case 'mutate':",
                    '        exports.switched = true;',
                    '        break;',
                    '    default:',
                    '        break;',
                    '}',
                ],
                'for.cjs': [
                    'for (let index = 0; index < count; index += 1) {',
                    '    module.exports.forLoop = index;',
                    '}',
                ],
                'for-of.cjs': ['for (const value of values) {', '    exports.forOf = value;', '}'],
                'for-in.cjs': ['for (const key in values) {', '    module.exports.forIn = key;', '}'],
                'while.cjs': ['while (condition) {', '    exports.whileLoop = true;', '}'],
                'do-while.cjs': ['do {', '    module.exports.doWhile = true;', '} while (false);'],
                'try.cjs': ['try {', '    exports.inTry = true;', '} catch {}'],
                'catch.cjs': ['try {', '    risky();', '} catch {', '    module.exports.inCatch = true;', '}'],
                'finally.cjs': ['try {', '    void 0;', '} finally {', '    exports.inFinally = true;', '}'],
                'nested-block.cjs': [
                    'if (condition) {',
                    '    {',
                    '        const out = module.exports;',
                    '        out.nested = true;',
                    '    }',
                    '}',
                ],
                'iife-control.cjs': [
                    '(() => {',
                    '    if (condition) {',
                    '        module.exports.iifeControl = true;',
                    '    }',
                    '})();',
                ],
                'control-iife.cjs': [
                    'if (condition) {',
                    '    (() => {',
                    '        exports.controlIife = true;',
                    '    })();',
                    '}',
                ],
                'alias.cjs': [
                    'if (condition) {',
                    '    const out = module.exports;',
                    '    out.aliasMutation = true;',
                    '}',
                ],
                'object-assign.cjs': [
                    'switch (selector) {',
                    "    case 'mutate':",
                    '        Object.assign(module.exports, { assigned: true });',
                    '        break;',
                    '}',
                ],
                'condition.cjs': ['if ((exports.conditionMutation = condition)) {', '    void 0;', '}'],
                'deduplicated-if.cjs': [
                    'if (condition) {',
                    '    exports.first = true;',
                    '    module.exports.second = true;',
                    '}',
                ],
                'if-false.cjs': ['if (false) {', '    module.exports.unreachable = true;', '}'],
                'if-true-else.cjs': [
                    'if (true) {',
                    '    void 0;',
                    '} else {',
                    '    exports.unreachableElse = true;',
                    '}',
                ],
                'while-false.cjs': ['while (false) {', '    exports.unreachable = true;', '}'],
                'for-false.cjs': ['for (; false; ) {', '    module.exports.unreachable = true;', '}'],
                'switch-false.cjs': [
                    'switch (false) {',
                    '    case true:',
                    '        exports.unreachable = true;',
                    '        break;',
                    '}',
                ],
                'switch-break.cjs': [
                    "switch ('clean') {",
                    "    case 'clean':",
                    '        break;',
                    "    case 'unreachable':",
                    '        exports.unreachableAfterBreak = true;',
                    '}',
                ],
                'switch-fallthrough.cjs': [
                    "switch ('clean') {",
                    "    case 'clean':",
                    '        void 0;',
                    "    case 'mutate':",
                    '        exports.reachableByFallthrough = true;',
                    '}',
                ],
                'detached-alias.cjs': [
                    'const out = module.exports;',
                    'module.exports = { clean: true };',
                    'if (condition) {',
                    '    out.detached = true;',
                    '}',
                ],
                'detached-exports.cjs': [
                    'module.exports = { clean: true };',
                    'if (condition) {',
                    '    exports.detached = true;',
                    '}',
                ],
                'reassigned-alias.cjs': [
                    'let out = module.exports;',
                    'if (condition) {',
                    '    out = {};',
                    '    out.reassigned = true;',
                    '}',
                ],
                'reassigned-exports.cjs': [
                    'if (condition) {',
                    '    exports = {};',
                    '    exports.reassigned = true;',
                    '}',
                ],
                'reassigned-module.cjs': [
                    'if (condition) {',
                    '    module = { exports: {} };',
                    '    module.exports.reassigned = true;',
                    '}',
                ],
                'shadowed-carriers.cjs': [
                    'if (condition) {',
                    '    ((module, exports) => {',
                    '        module.exports = { shadowedModule: true };',
                    '        exports.shadowedExports = true;',
                    '    })({ exports: {} }, {});',
                    '}',
                ],
                'unrelated-object.cjs': [
                    'const target = {};',
                    'if (condition) {',
                    '    target.value = true;',
                    '    Object.assign(target, unknownSource);',
                    '}',
                ],
                'noninvoked.cjs': [
                    'if (condition) {',
                    '    const later = () => {',
                    '        module.exports.noninvoked = true;',
                    '    };',
                    '    void later;',
                    '}',
                ],
                'unreachable-iife.cjs': [
                    'if (false) {',
                    '    (() => {',
                    '        exports.unreachableIife = true;',
                    '    })();',
                    '}',
                ],
                'nonmutating-controls.cjs': [
                    'if (condition) { void 0; }',
                    'switch (selector) { default: break; }',
                    'for (; condition; ) { break; }',
                    'for (const value of values) { void value; }',
                    'for (const key in values) { void key; }',
                    'while (condition) { break; }',
                    'do { break; } while (condition);',
                    'try { void 0; } catch {} finally { void 0; }',
                ],
                'bounded-control.cjs': boundedControl,
                'bounded-switch.cjs': ['const unrelated = {};', ...boundedSwitch],
            });

            const startedAt = performance.now();
            const findings = invokeStaticGuardFindings(repositoryRoot);
            const elapsedMs = performance.now() - startedAt;

            expect(findings).toEqual([
                unsupportedCommonJsFinding('src/modules/Foo/repositories/alias.cjs', 1),
                unsupportedCommonJsFinding('src/modules/Foo/repositories/catch.cjs', 1),
                unsupportedCommonJsFinding('src/modules/Foo/repositories/condition.cjs', 1),
                unsupportedCommonJsFinding('src/modules/Foo/repositories/control-iife.cjs', 1),
                unsupportedCommonJsFinding('src/modules/Foo/repositories/deduplicated-if.cjs', 1),
                unsupportedCommonJsFinding('src/modules/Foo/repositories/do-while.cjs', 1),
                unsupportedCommonJsFinding('src/modules/Foo/repositories/finally.cjs', 1),
                unsupportedCommonJsFinding('src/modules/Foo/repositories/for-in.cjs', 1),
                unsupportedCommonJsFinding('src/modules/Foo/repositories/for-of.cjs', 1),
                unsupportedCommonJsFinding('src/modules/Foo/repositories/for.cjs', 1),
                unsupportedCommonJsFinding('src/modules/Foo/repositories/if.cjs', 1),
                unsupportedCommonJsFinding('src/modules/Foo/repositories/iife-control.cjs', 2),
                unsupportedCommonJsFinding('src/modules/Foo/repositories/nested-block.cjs', 1),
                unsupportedCommonJsFinding('src/modules/Foo/repositories/object-assign.cjs', 1),
                unsupportedCommonJsFinding('src/modules/Foo/repositories/switch-fallthrough.cjs', 1),
                unsupportedCommonJsFinding('src/modules/Foo/repositories/switch.cjs', 1),
                unsupportedCommonJsFinding('src/modules/Foo/repositories/try.cjs', 1),
                unsupportedCommonJsFinding('src/modules/Foo/repositories/while.cjs', 1),
            ]);
            expect(elapsedMs).toBeLessThan(10_000);
        } finally {
            rmSync(repositoryRoot, { force: true, recursive: true });
        }
    });

    it('should reject shadowed require consumers while preserving real require consumers', () => {
        let repositoryRoot: string | undefined;

        try {
            repositoryRoot = mkdtempSync(join(tmpdir(), 'check-dependency-boundaries-require-shadow-'));
            const moduleDirectory = join(repositoryRoot, 'src/modules/Foo');
            const repositoryDirectory = join(moduleDirectory, 'repositories');
            const useCaseDirectory = join(moduleDirectory, 'useCases');
            const vendorDirectory = join(repositoryRoot, 'node_modules/@tauri-apps/api');
            mkdirSync(repositoryDirectory, { recursive: true });
            mkdirSync(useCaseDirectory, { recursive: true });
            mkdirSync(vendorDirectory, { recursive: true });

            writeFixtureFiles(repositoryRoot, {
                'package.json': JSON.stringify({ type: 'module' }),
                'src/globals.d.ts': 'declare function require(moduleName: string): any;\n',
            });
            writeFixtureFiles(vendorDirectory, {
                'package.json': JSON.stringify({
                    name: '@tauri-apps/api',
                    type: 'module',
                    exports: {
                        './core': {
                            types: './core.d.ts',
                            default: './core.js',
                        },
                    },
                }),
                'core.js': 'export const invoke = null;\n',
                'core.d.ts': 'export type InvokeArgs = { command: string };\n',
            });
            writeFixtureFiles(repositoryDirectory, {
                'positive-require.cjs': [
                    "/** @type {import('@tauri-apps/api/core').InvokeArgs} */",
                    "const leaked = { command: 'positive-require' };",
                    'module.exports = { leaked };',
                ],
                'shadowed-require.cjs': [
                    "/** @type {import('@tauri-apps/api/core').InvokeArgs} */",
                    "const leaked = { command: 'shadowed-require' };",
                    'module.exports = { leaked };',
                ],
            });
            writeFixtureFiles(useCaseDirectory, {
                'consume-real-require.ts': [
                    "const { leaked } = require('../repositories/positive-require.cjs');",
                    'void leaked;',
                ],
                'consume-shadowed-require.ts': [
                    'export function consume(require: (moduleName: string) => { leaked: unknown }) {',
                    "    const { leaked } = require('../repositories/shadowed-require.cjs');",
                    '    return leaked;',
                    '}',
                ],
            });

            const vendorFindings = invokeStaticGuardFindings(repositoryRoot).filter(({ reason }) =>
                reason.includes('Tauri vendor type')
            );

            expect(vendorFindings).toEqual([vendorFinding('src/modules/Foo/repositories/positive-require.cjs', 3)]);
        } finally {
            if (repositoryRoot) {
                rmSync(repositoryRoot, { force: true, recursive: true });
            }
        }
    });

    it('should match vendor bindings by checker symbol, not a same-name local type parameter', () => {
        let repositoryRoot: string | undefined;

        try {
            repositoryRoot = mkdtempSync(join(tmpdir(), 'check-dependency-boundaries-binding-symbol-'));
            const moduleDirectory = join(repositoryRoot, 'src/modules/Foo');
            const repositoryDirectory = join(moduleDirectory, 'repositories');
            const useCaseDirectory = join(moduleDirectory, 'useCases');
            const vendorDirectory = join(repositoryRoot, 'node_modules/@tauri-apps/api');
            mkdirSync(repositoryDirectory, { recursive: true });
            mkdirSync(useCaseDirectory, { recursive: true });
            mkdirSync(vendorDirectory, { recursive: true });

            writeFixtureFiles(repositoryRoot, { 'package.json': JSON.stringify({ type: 'module' }) });
            writeFixtureFiles(vendorDirectory, {
                'package.json': JSON.stringify({
                    name: '@tauri-apps/api',
                    type: 'module',
                    exports: {
                        './core': {
                            types: './core.d.ts',
                            default: './core.js',
                        },
                    },
                }),
                'core.js': 'export const invoke = null;\n',
                'core.d.ts': 'export type InvokeArgs = { command: string };\n',
            });
            writeFixtureFiles(repositoryDirectory, {
                'actual-binding.ts': [
                    "import type { InvokeArgs as ActualArgs } from '@tauri-apps/api/core';",
                    'export type ActualPublic = ActualArgs;',
                ],
                'shadowed-binding.ts': [
                    "import type { InvokeArgs as ImportedArgs } from '@tauri-apps/api/core';",
                    'type ShadowedArgs = ImportedArgs;',
                    'export function clean<ShadowedArgs>(value: ShadowedArgs): ShadowedArgs {',
                    '    return value;',
                    '}',
                ],
            });
            writeFixtureFiles(useCaseDirectory, {
                'consume-binding-symbols.ts': [
                    "import type { ActualPublic } from '../repositories/actual-binding';",
                    "import { clean } from '../repositories/shadowed-binding';",
                    'export type Consumed = ActualPublic;',
                    'void clean;',
                ],
            });

            const vendorFindings = invokeStaticGuardFindings(repositoryRoot).filter(({ reason }) =>
                reason.includes('Tauri vendor type')
            );

            expect(vendorFindings).toEqual([vendorFinding('src/modules/Foo/repositories/actual-binding.ts', 2)]);
        } finally {
            if (repositoryRoot) {
                rmSync(repositoryRoot, { force: true, recursive: true });
            }
        }
    });

    it('should inspect the full repository surface for rest destructuring', () => {
        let repositoryRoot: string | undefined;

        try {
            repositoryRoot = mkdtempSync(join(tmpdir(), 'check-dependency-boundaries-require-rest-'));
            const moduleDirectory = join(repositoryRoot, 'src/modules/Foo');
            const repositoryDirectory = join(moduleDirectory, 'repositories');
            const useCaseDirectory = join(moduleDirectory, 'useCases');
            const vendorDirectory = join(repositoryRoot, 'node_modules/@tauri-apps/api');
            mkdirSync(repositoryDirectory, { recursive: true });
            mkdirSync(useCaseDirectory, { recursive: true });
            mkdirSync(vendorDirectory, { recursive: true });

            writeFixtureFiles(repositoryRoot, {
                'package.json': JSON.stringify({ type: 'module' }),
                'src/globals.d.ts': 'declare function require(moduleName: string): any;\n',
            });
            writeFixtureFiles(vendorDirectory, {
                'package.json': JSON.stringify({
                    name: '@tauri-apps/api',
                    type: 'module',
                    exports: {
                        './core': {
                            types: './core.d.ts',
                            default: './core.js',
                        },
                    },
                }),
                'core.js': 'export const invoke = null;\n',
                'core.d.ts': 'export type InvokeArgs = { command: string };\n',
            });
            writeFixtureFiles(repositoryDirectory, {
                'rest-surface.cjs': [
                    "/** @type {import('@tauri-apps/api/core').InvokeArgs} */",
                    "const namedLeaked = { command: 'named-rest' };",
                    "/** @type {import('@tauri-apps/api/core').InvokeArgs} */",
                    "const restLeaked = { command: 'rest-only' };",
                    'exports.namedLeaked = namedLeaked;',
                    'exports.restLeaked = restLeaked;',
                ],
            });
            writeFixtureFiles(useCaseDirectory, {
                'consume-rest.ts': [
                    "const { namedLeaked, ...rest } = require('../repositories/rest-surface.cjs');",
                    'void namedLeaked;',
                    'void rest;',
                ],
            });

            const vendorFindings = invokeStaticGuardFindings(repositoryRoot).filter(({ reason }) =>
                reason.includes('Tauri vendor type')
            );

            expect(vendorFindings).toEqual(
                expect.arrayContaining([
                    vendorFinding('src/modules/Foo/repositories/rest-surface.cjs', 5),
                    vendorFinding('src/modules/Foo/repositories/rest-surface.cjs', 6),
                ])
            );
            expect(vendorFindings).toHaveLength(2);
        } finally {
            if (repositoryRoot) {
                rmSync(repositoryRoot, { force: true, recursive: true });
            }
        }
    });

    it('should propagate vendor relevance through an adversarial long repository chain', () => {
        let repositoryRoot: string | undefined;

        try {
            repositoryRoot = mkdtempSync(join(tmpdir(), 'check-dependency-boundaries-relevance-chain-'));
            const moduleDirectory = join(repositoryRoot, 'src/modules/Foo');
            const repositoryDirectory = join(moduleDirectory, 'repositories');
            const useCaseDirectory = join(moduleDirectory, 'useCases');
            const vendorDirectory = join(repositoryRoot, 'node_modules/@tauri-apps/api');
            const chainLength = 700;
            mkdirSync(repositoryDirectory, { recursive: true });
            mkdirSync(useCaseDirectory, { recursive: true });
            mkdirSync(vendorDirectory, { recursive: true });

            const fixtures: Record<string, FixtureContents> = {
                'package.json': JSON.stringify({ type: 'module' }),
                'src/globals.d.ts': 'declare function require(moduleName: string): any;\n',
                'node_modules/@tauri-apps/api/package.json': JSON.stringify({
                    name: '@tauri-apps/api',
                    type: 'module',
                    exports: {
                        './core': {
                            types: './core.d.ts',
                            default: './core.js',
                        },
                    },
                }),
                'node_modules/@tauri-apps/api/core.js': 'export const invoke = null;\n',
                'node_modules/@tauri-apps/api/core.d.ts': [
                    'export type InvokeArgs = { command: string };',
                    'export declare function invoke(command: string): Promise<unknown>;',
                ],
                'src/modules/Foo/repositories/zz-vendor.ts': [
                    "import { invoke } from '@tauri-apps/api/core';",
                    'const privateValue = { invoke };',
                    'export { privateValue };',
                ],
                'src/modules/Foo/useCases/consume-chain.ts': [
                    "import { publicValue } from '../repositories/chain-0000';",
                    'void publicValue;',
                ],
            };
            for (let index = 0; index < chainLength; index += 1) {
                const current = String(index).padStart(4, '0');
                const next = index === chainLength - 1 ? 'zz-vendor' : `chain-${String(index + 1).padStart(4, '0')}`;
                const targetName = index === chainLength - 1 ? 'privateValue' : 'publicValue';
                fixtures[`src/modules/Foo/repositories/chain-${current}.ts`] =
                    `export { ${targetName} as publicValue } from './${next}';\n`;
            }
            writeFixtureFiles(repositoryRoot, fixtures);

            const startedAt = performance.now();
            const vendorFindings = invokeStaticGuardFindings(repositoryRoot).filter(({ reason }) =>
                reason.includes('Tauri vendor type')
            );
            const elapsedMs = performance.now() - startedAt;

            expect(vendorFindings).toContainEqual(vendorFinding('src/modules/Foo/repositories/chain-0000.ts', 1));
            expect(elapsedMs).toBeLessThan(10_000);
        } finally {
            if (repositoryRoot) {
                rmSync(repositoryRoot, { force: true, recursive: true });
            }
        }
    }, 20_000);

    it('should enforce TitleCase model targets from the configured rule', () => {
        const modelRule = mainConfig.forbidden.find(
            (candidate: { name: string }) => candidate.name === 'models-must-be-title-case'
        );
        const testModelRule = testConfig.forbidden.find(
            (candidate: { name: string }) => candidate.name === 'models-must-be-title-case'
        );
        const matches = (patterns: string | string[] | undefined, filePath: string): boolean => {
            let patternList: string[];
            if (Array.isArray(patterns)) {
                patternList = patterns;
            } else if (patterns) {
                patternList = [patterns];
            } else {
                patternList = [];
            }
            return patternList.some((pattern) => new RegExp(pattern).test(filePath));
        };
        const violates = (filePath: string): boolean =>
            matches(modelRule.to.path, filePath) && !matches(modelRule.to.pathNot, filePath);

        expect(modelRule.severity).toBe('error');
        expect(testModelRule).toBe(modelRule);
        expect(violates('src/modules/Foo/models/foo/FooBar.ts')).toBe(true);
        expect(violates('src/modules/Foo/models/Foo/bar/FooBar.ts')).toBe(true);
        expect(violates('src/modules/Foo/models/Foo/fooBar.ts')).toBe(true);
        expect(violates('src/modules/Foo/models/Foo/Bar/baz.ts')).toBe(true);
        expect(violates('src/modules/Foo/models/Foo/_Bad.ts')).toBe(true);
        expect(violates('src/modules/Foo/models/Foo/Bar/index.ts')).toBe(true);
        expect(violates('src/modules/Foo/models/Foo/__tests__support/Bad.ts')).toBe(true);
        expect(violates('src/modules/Foo/models/Foo/Bar/Baz.ts')).toBe(false);
        expect(violates('src/modules/Command/models/Commands/__tests__/EditCommands.spec.ts')).toBe(false);
        expect(violates('src/modules/Transport/models/index.ts')).toBe(false);
    });

    it('should preflight unreferenced model paths without broad test exclusions', () => {
        const findings = findModelCasingFindings([
            'src/modules/Foo/models/foo/FooBar.ts',
            'src/modules/Foo/models/Foo/bar/Baz.ts',
            'src/modules/Foo/models/Foo/fooBar.ts',
            'src/modules/Foo/models/Foo/_Bad.ts',
            'src/modules/Foo/models/Foo/Bar/badFile.ts',
            'src/modules/Foo/models/Foo/Bar/index.ts',
            'src/modules/Foo/models/Foo/__tests__support/Bad.ts',
            'src/modules/Foo/models/Foo/Bar/Baz.ts',
            'src/modules/Command/models/Commands/__tests__/EditCommands.spec.ts',
            'src/modules/Transport/models/index.ts',
        ]);

        expect(findings.map(({ file }: { file: string }) => file)).toEqual([
            'src/modules/Foo/models/Foo/Bar/badFile.ts',
            'src/modules/Foo/models/Foo/Bar/index.ts',
            'src/modules/Foo/models/Foo/_Bad.ts',
            'src/modules/Foo/models/Foo/__tests__support/Bad.ts',
            'src/modules/Foo/models/Foo/bar/Baz.ts',
            'src/modules/Foo/models/Foo/fooBar.ts',
            'src/modules/Foo/models/foo/FooBar.ts',
        ]);
    });

    it('should reject symlinked model directories and source files before walking targets', ({ skip }) => {
        let repositoryRoot: string | undefined;
        let targetDirectory: string | undefined;

        try {
            repositoryRoot = mkdtempSync(join(tmpdir(), 'check-dependency-boundaries-repo-'));
            targetDirectory = mkdtempSync(join(tmpdir(), 'check-dependency-boundaries-target-'));

            const moduleDirectory = join(repositoryRoot, 'src/modules/SymlinkRegression');
            const targetModelsDirectory = join(targetDirectory, 'models-target');
            const targetModelsFile = join(targetModelsDirectory, 'foo', 'Hidden.ts');
            const targetSourceFile = join(targetDirectory, 'UseCasesIndex.ts');
            const symlinkedModelsDirectory = join(moduleDirectory, 'models');
            const symlinkedSourceFile = join(moduleDirectory, 'useCases/index.ts');

            mkdirSync(dirname(targetModelsFile), { recursive: true });
            mkdirSync(join(moduleDirectory, 'useCases'), { recursive: true });
            writeFileSync(targetModelsFile, 'export const hidden = true;\n');
            writeFileSync(targetSourceFile, "export { run, type RunInput } from './run';\n");

            try {
                symlinkSync(targetModelsDirectory, symlinkedModelsDirectory, 'dir');
                symlinkSync(targetSourceFile, symlinkedSourceFile, 'file');
            } catch (error: unknown) {
                if (isUnsupportedSymlinkError(error)) {
                    skip();
                    return;
                }
                throw error;
            }

            const findings = findStaticGuardFindings(repositoryRoot);
            const relativeModelsPath = relative(repositoryRoot, symlinkedModelsDirectory).replaceAll('\\', '/');
            const relativeSourcePath = relative(repositoryRoot, symlinkedSourceFile).replaceAll('\\', '/');

            expect(findings).toEqual([
                {
                    file: relativeModelsPath,
                    line: 1,
                    reason: 'symbolic links are not permitted under src/modules',
                },
                {
                    file: relativeSourcePath,
                    line: 1,
                    reason: 'symbolic links are not permitted under src/modules',
                },
            ]);
            expect(new Set(findings.map(({ file }) => file)).size).toBe(findings.length);
        } finally {
            if (repositoryRoot) {
                rmSync(repositoryRoot, { force: true, recursive: true });
            }
            if (targetDirectory) {
                rmSync(targetDirectory, { force: true, recursive: true });
            }
        }
    });

    it('should apply architecture boundaries to type-only edges', () => {
        const typeRuleNames = new Set(typeConfig.forbidden.map((candidate: { name: string }) => candidate.name));

        expect([...typeRuleNames]).toEqual(
            expect.arrayContaining([
                'app-to-modules-public-surface-only-type-only',
                'models-are-pure-type-only',
                'no-relative-cross-module-imports-type-only',
                'module-runtime-no-worklet-imports-type-only',
                'workers-no-module-runtime-imports-type-only',
                'module-runtime-no-worker-imports-type-only',
                'react-only-in-presentation-type-only',
            ])
        );

        const reverseTypeRule = typeConfig.forbidden.find(
            (candidate: { name: string }) => candidate.name === 'module-runtime-no-worklet-imports-type-only'
        );
        expect(new RegExp(reverseTypeRule.from.path).test('src/modules/Yeast/useCases/types.ts')).toBe(true);
        expect(new RegExp(reverseTypeRule.to.path).test('src/modules/AudioEngine/worklets/MidiRack.ts')).toBe(true);

        const reverseWorkerTypeRule = typeConfig.forbidden.find(
            (candidate: { name: string }) => candidate.name === 'module-runtime-no-worker-imports-type-only'
        );
        expect(new RegExp(reverseWorkerTypeRule.to.path).test('src/modules/Yeast/workers/MidiRack.ts')).toBe(true);
    });
});
