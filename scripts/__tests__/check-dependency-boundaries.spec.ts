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

function commonJsSurfaceFinding(file: string, line: number) {
    return {
        file,
        line,
        reason: 'CommonJS module, exports, and require are not available under src',
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
        expect(isExcluded('src/modules/Transport/models/DeadModel.ts')).toBe(false);
        expect(isExcluded('src/modules/Transport/events/DeadEvent.ts')).toBe(false);
        expect(isExcluded('src/modules/Transport/types.ts')).toBe(false);
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
                'jsdoc-name.js': [
                    '/**',
                    " * @param {import('@tauri-apps/api/core').InvokeArgs} args",
                    " * @returns {import('@tauri-apps/api/core').InvokeArgs}",
                    ' */',
                    'export function send(args) {',
                    '    return args;',
                    '}',
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
                    "import { send } from '../repositories/jsdoc-name.js';",
                    "import { request, makeRequest, RequestBox, makeGeneric } from '../repositories/inferred.mts';",
                    "import { publicValue } from '../repositories/chain-two';",
                    "import type { ExternalRequest } from '../repositories/external-helper';",
                    "import { internalImplementation, InternalImplementation } from '../repositories/internal-implementation';",
                    'export const consumed = [',
                    '    exportAssignment,',
                    '    send,',
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
                    vendorFinding('src/modules/Foo/repositories/jsdoc-name.js', 5),
                    vendorFinding('src/modules/Foo/repositories/inferred.mts', 12),
                    vendorFinding('src/modules/Foo/repositories/inferred.mts', 13),
                    vendorFinding('src/modules/Foo/repositories/inferred.mts', 14),
                    vendorFinding('src/modules/Foo/repositories/inferred.mts', 15),
                    vendorFinding('src/modules/Foo/repositories/chain-two.ts', 1),
                    vendorFinding('src/modules/Foo/repositories/external-helper.ts', 2),
                ])
            );
            expect(findings).toHaveLength(8);
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

    it('should keep clean runtime values out of the surface while reporting import types', () => {
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
                    "export type ExternalMember = import('../repositories/import-type-source').Leaked;",
                    "export type ExternalQualified = import('../repositories/import-type-source').Api.Leaked;",
                    "export type ExternalWhole = typeof import('../repositories/import-type-source');",
                    "export const load = () => import('../repositories/import-type-source');",
                    '',
                    'void runtimeString;',
                    'void runtimePromise;',
                    'void runtimeFunction;',
                    'void runtimeFactory;',
                ],
            });

            const findings = invokeStaticGuardFindings(repositoryRoot);
            const vendorFindings = findings.filter(({ reason }) => reason.includes('Tauri vendor type'));

            expect(vendorFindings).toEqual([
                vendorFinding('src/modules/Foo/repositories/import-type-source.ts', 1),
                vendorFinding('src/modules/Foo/repositories/import-type-source.ts', 3),
            ]);
            expect(vendorFindings).not.toEqual(
                expect.arrayContaining([
                    vendorFinding('src/modules/Foo/repositories/runtime-only.ts', 3),
                    vendorFinding('src/modules/Foo/repositories/runtime-only.ts', 4),
                    vendorFinding('src/modules/Foo/repositories/runtime-only.ts', 5),
                    vendorFinding('src/modules/Foo/repositories/factory-runtime.ts', 3),
                ])
            );
            expect(findings).toHaveLength(2);
        } finally {
            if (repositoryRoot) {
                rmSync(repositoryRoot, { force: true, recursive: true });
            }
        }
    });

    it('should refuse every CommonJS runtime name under src, whatever is done with it', () => {
        const { repositoryDirectory, repositoryRoot, useCaseDirectory } = createCommonJsStaticGuardFixture(
            'check-dependency-boundaries-commonjs-refusal-'
        );

        try {
            writeFixtureFiles(repositoryDirectory, {
                // Each of these was a separate branch of the interpreter that used to decide whether the
                // mutation reached the public surface. The refusal reports the runtime name itself, so
                // the classification never happens and cannot be wrong.
                'direct.cjs': ['const value = {};', 'module.exports = value;'],
                'named.cjs': ['const value = {};', 'exports.value = value;'],
                'element.cjs': ['const value = {};', "module['exports'] = value;"],
                'aliased.cjs': ['const own = module.exports;', 'own.value = {};'],
                'object-assign.cjs': ['Object.assign(exports, { value: {} });'],
                'iife.cjs': ['(() => {', '    module.exports = { value: {} };', '})();'],
                'inside-branch.cjs': ['if (globalThis.flag) {', '    exports.value = {};', '}'],
                'require-call.cjs': ["const loaded = require('node:path');", 'exports.loaded = loaded;'],
                'require-alias.cjs': ['const load = require;', "const loaded = load('node:path');", 'void loaded;'],
                'shorthand.cjs': ['const carrier = { exports };', 'void carrier;'],
            });
            writeFixtureFiles(useCaseDirectory, {
                'consume-refusal.ts': ['export const consumed = true;'],
            });

            const findings = invokeStaticGuardFindings(repositoryRoot).filter(({ reason }) =>
                reason.includes('CommonJS')
            );

            // `aliased.cjs` and `require-alias.cjs` are each reported once, at the line that names the
            // runtime object. What the local alias does afterwards no longer has to be classified.
            expect(findings).toEqual([
                commonJsSurfaceFinding('src/modules/Foo/repositories/aliased.cjs', 1),
                commonJsSurfaceFinding('src/modules/Foo/repositories/direct.cjs', 2),
                commonJsSurfaceFinding('src/modules/Foo/repositories/element.cjs', 2),
                commonJsSurfaceFinding('src/modules/Foo/repositories/iife.cjs', 2),
                commonJsSurfaceFinding('src/modules/Foo/repositories/inside-branch.cjs', 2),
                commonJsSurfaceFinding('src/modules/Foo/repositories/named.cjs', 2),
                commonJsSurfaceFinding('src/modules/Foo/repositories/object-assign.cjs', 1),
                commonJsSurfaceFinding('src/modules/Foo/repositories/require-alias.cjs', 1),
                commonJsSurfaceFinding('src/modules/Foo/repositories/require-call.cjs', 1),
                commonJsSurfaceFinding('src/modules/Foo/repositories/require-call.cjs', 2),
                commonJsSurfaceFinding('src/modules/Foo/repositories/shorthand.cjs', 1),
            ]);
        } finally {
            rmSync(repositoryRoot, { force: true, recursive: true });
        }
    });

    it('should refuse CommonJS outside repositories and leave same-named locals alone', () => {
        const { repositoryDirectory, repositoryRoot, useCaseDirectory } = createCommonJsStaticGuardFixture(
            'check-dependency-boundaries-commonjs-scope-'
        );

        try {
            mkdirSync(join(repositoryRoot, 'src/utils'), { recursive: true });
            writeFixtureFiles(repositoryRoot, {
                // No consumer reaches this file, and it is in neither a repository nor a use case. The
                // vendor-type walk would never look at it; the refusal still does.
                'src/utils/legacy.cjs': ['const helper = {};', 'module.exports = helper;'],
            });
            writeFixtureFiles(repositoryDirectory, {
                'locals.ts': [
                    'type Loader = (name: string) => unknown;',
                    'export function load(require: Loader, exports: Record<string, unknown>) {',
                    "    exports.value = require('node:path');",
                    '    return exports;',
                    '}',
                    'export const shape = { module: 1, exports: 2 };',
                    'export const read = shape.module + shape.exports;',
                ],
            });
            writeFixtureFiles(useCaseDirectory, {
                'consume-locals.ts': [
                    "import { load, read, shape } from '../repositories/locals';",
                    'export const consumed = [load, read, shape];',
                ],
            });

            const findings = invokeStaticGuardFindings(repositoryRoot).filter(({ reason }) =>
                reason.includes('CommonJS')
            );

            expect(findings).toEqual([commonJsSurfaceFinding('src/utils/legacy.cjs', 2)]);
        } finally {
            rmSync(repositoryRoot, { force: true, recursive: true });
        }
    });

    it('should follow signatures of third-party and project types that carry a vendor type', () => {
        let repositoryRoot: string | undefined;

        try {
            repositoryRoot = mkdtempSync(join(tmpdir(), 'check-dependency-boundaries-external-signature-'));
            const moduleDirectory = join(repositoryRoot, 'src/modules/Foo');
            const repositoryDirectory = join(moduleDirectory, 'repositories');
            const useCaseDirectory = join(moduleDirectory, 'useCases');
            const vendorDirectory = join(repositoryRoot, 'node_modules/@tauri-apps/api');
            const thirdPartyDirectory = join(repositoryRoot, 'node_modules/vendorlib');
            mkdirSync(repositoryDirectory, { recursive: true });
            mkdirSync(useCaseDirectory, { recursive: true });
            mkdirSync(vendorDirectory, { recursive: true });
            mkdirSync(thirdPartyDirectory, { recursive: true });

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
                'core.d.ts': [
                    'export type InvokeArgs = { command: string };',
                    'export type InvokeResult = { data: string };',
                ],
            });
            // A third-party package can name a type from another package in its own signature, with
            // no type-argument path to it. The syntax pass never reads a file outside `src`, so the
            // signature walk is the only route to it.
            writeFixtureFiles(thirdPartyDirectory, {
                'package.json': JSON.stringify({
                    name: 'vendorlib',
                    type: 'module',
                    exports: { '.': { types: './index.d.ts', default: './index.js' } },
                }),
                'index.js': 'export const nothing = null;\n',
                'index.d.ts': [
                    "import type { InvokeArgs, InvokeResult } from '@tauri-apps/api/core';",
                    'export interface CallableHandler {',
                    '    (args: InvokeArgs): void;',
                    '}',
                    'export interface ConstructHandler {',
                    '    new (): InvokeResult;',
                    '}',
                ],
            });
            writeFixtureFiles(repositoryDirectory, {
                // Reaches a Tauri type directly, which is what puts this repository's files in the
                // relevance set the vendor walk starts from.
                'seed.ts': [
                    "import type { InvokeResult } from '@tauri-apps/api/core';",
                    'export type Seed = InvokeResult;',
                ],
                'callable-external.ts': [
                    "import type { CallableHandler } from 'vendorlib';",
                    "import type { Seed } from './seed.js';",
                    'export const callableHandler: CallableHandler = () => undefined;',
                    'export type SeededResult = Seed;',
                ],
                'construct-external.ts': [
                    "import type { ConstructHandler } from 'vendorlib';",
                    "import type { Seed } from './seed.js';",
                    'export const ConstructHandlerImpl: ConstructHandler = null as unknown as ConstructHandler;',
                    'export type SeededConstruct = Seed;',
                ],
                // Named like a TypeScript lib file but owned by this repository, so it must still be
                // walked as project code.
                'lib.custom.d.ts': [
                    "import type { InvokeArgs } from '@tauri-apps/api/core';",
                    'export type LibNamedCallable = { (args: InvokeArgs): void };',
                ],
                'callable-lib-named.ts': [
                    "import type { LibNamedCallable } from './lib.custom.js';",
                    'export const libNamedCallable: LibNamedCallable = () => undefined;',
                ],
            });
            writeFixtureFiles(useCaseDirectory, {
                'consume-external-signatures.ts': [
                    "import { callableHandler } from '../repositories/callable-external';",
                    "import { ConstructHandlerImpl } from '../repositories/construct-external';",
                    "import { libNamedCallable } from '../repositories/callable-lib-named';",
                    'export const consumed = [callableHandler, ConstructHandlerImpl, libNamedCallable];',
                ],
            });

            const vendorFindings = invokeStaticGuardFindings(repositoryRoot).filter(({ reason }) =>
                reason.includes('Tauri vendor type')
            );

            // Each of the three reaches `InvokeArgs`/`InvokeResult` only through a call or construct
            // signature: two through `vendorlib`'s own declaration, one through a repository file
            // whose name matches the TypeScript lib pattern.
            expect(vendorFindings).toEqual([
                vendorFinding('src/modules/Foo/repositories/callable-external.ts', 3),
                vendorFinding('src/modules/Foo/repositories/callable-lib-named.ts', 2),
                vendorFinding('src/modules/Foo/repositories/construct-external.ts', 3),
            ]);
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
