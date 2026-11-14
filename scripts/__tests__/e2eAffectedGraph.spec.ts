// @vitest-environment node

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';

import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
    completeRuntimeGraph,
    loadAffectedE2e,
    loadRuntimeGraph,
    offPageSources,
    selectAffectedE2e,
    type SourceNode,
} from '../e2eAffectedGraph';

const observedGraphs = vi.hoisted(() => new Array<string>());
const observedRoots = vi.hoisted(() => new Array<string>());

vi.mock('dependency-cruiser', async (importOriginal) => {
    const actual = await importOriginal<typeof import('dependency-cruiser')>();
    return {
        ...actual,
        cruise: async (...args: Parameters<typeof actual.cruise>) => {
            const result = await actual.cruise(...args);
            if (typeof result.output === 'string') {
                rejectGraphsOutsideObservedRoot(result.output);
                observedGraphs.push(result.output);
            }
            return result;
        },
    };
});

function graphModules(output: string): unknown[] {
    const parsed: unknown = JSON.parse(output);
    if (typeof parsed !== 'object' || parsed === null || !('modules' in parsed) || !Array.isArray(parsed.modules)) {
        throw new Error('installed cruise emitted an invalid graph');
    }
    return parsed.modules;
}

/**
 * A resolver that lost its alias base silently rebases '#' imports onto the
 * process cwd and cruises the caller's repository instead of the fixture
 * (#5290): repeated repository-scale cruises then burn the case's deadline
 * before any source-set assertion can name the escape. Refuse the first
 * graph that leaves the declared fixture root.
 */
function rejectGraphsOutsideObservedRoot(output: string): void {
    const root = observedRoots.at(-1);
    if (root === undefined) {
        return;
    }
    const fixtureRoot = realpathSync(root);
    const escaped = graphModules(output)
        .map((node: unknown) => {
            if (typeof node !== 'object' || node === null || !('source' in node) || typeof node.source !== 'string') {
                throw new Error('installed cruise emitted an invalid source');
            }
            return node.source;
        })
        .filter((source) => !realpathSync(resolve(root, source)).startsWith(`${fixtureRoot}${sep}`));
    if (escaped.length > 0) {
        throw new Error(
            `cruise escaped the fixture root: ${escaped.length} sources including ${escaped.slice(0, 3).join(', ')}`
        );
    }
}

function observedModules(): unknown[] {
    const output = observedGraphs.at(-1);
    if (output === undefined) {
        throw new Error('installed cruise did not emit a graph');
    }
    return graphModules(output);
}

function observedSources(): string[] {
    return observedModules()
        .map((node: unknown) => {
            if (typeof node !== 'object' || node === null || !('source' in node) || typeof node.source !== 'string') {
                throw new Error('installed cruise emitted an invalid source');
            }
            return node.source;
        })
        .sort();
}

function observedDependencies(source: string): string[] {
    const node = observedModules().find(
        (node) => typeof node === 'object' && node !== null && 'source' in node && node.source === source
    );
    if (typeof node !== 'object' || node === null || !('dependencies' in node) || !Array.isArray(node.dependencies)) {
        throw new Error('installed cruise did not emit source dependencies');
    }
    return node.dependencies
        .map((dependency: unknown) => {
            if (
                typeof dependency !== 'object' ||
                dependency === null ||
                !('resolved' in dependency) ||
                typeof dependency.resolved !== 'string'
            ) {
                throw new Error('installed cruise emitted an invalid dependency');
            }
            return dependency.resolved;
        })
        .sort();
}

const TUNER = 'src/modules/Tuner/presentations/components/TunerDisplay.tsx';
const PANEL = 'src/modules/Tuner/presentations/views/TunerPanel.tsx';
const BARREL = 'src/modules/Tuner/presentations/views/index.ts';
const SHELL = 'src/modules/WorkspaceShell/presentations/views/AppShell.tsx';
const CRUST = 'src/modules/Crust/presentations/views/CrustPanel.tsx';
const CRUST_BARREL = 'src/modules/Crust/presentations/views/index.ts';
const TUNER_SPEC = 'tests/e2e/tuner.spec.ts';
const CRUST_SPEC = 'tests/e2e/crustAttackTimeTestId.spec.ts';
const AI_SPEC = 'tests/e2e/browserAiWebGpuAdmission.spec.ts';
const MIXED_SPEC = 'tests/e2e/devicePanelAllTestId.spec.ts';
const NEW_SPEC = 'tests/e2e/newWorkflow.spec.ts';
const inventory = ['tests/e2e/smoke.spec.ts', TUNER_SPEC, CRUST_SPEC, AI_SPEC, MIXED_SPEC, NEW_SPEC];
const manifest = {
    version: 1,
    owners: ['BrowserAi', 'Crust', 'Tuner'],
    entries: [
        { spec: TUNER_SPEC, owners: ['Tuner'] },
        { spec: CRUST_SPEC, owners: ['Crust'] },
        { spec: AI_SPEC, owners: ['BrowserAi'] },
    ],
};
const graph: SourceNode[] = [
    { source: TUNER, dependencies: [] },
    { source: PANEL, dependencies: [{ resolved: TUNER }] },
    { source: BARREL, dependencies: [{ resolved: PANEL }] },
    { source: CRUST, dependencies: [] },
    { source: CRUST_BARREL, dependencies: [{ resolved: CRUST }] },
    { source: SHELL, dependencies: [{ resolved: BARREL }, { resolved: CRUST_BARREL }] },
];

function withRuntimeSources(
    nodes: SourceNode[],
    sources: Readonly<Record<string, string>>,
    run: (root: string) => void
): void {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-affected-runtime-'));
    try {
        for (const node of nodes) {
            const file = join(root, node.source);
            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(file, sources[node.source] ?? '');
        }
        run(root);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

function selectCompleted(root: string, nodes: SourceNode[]) {
    const completed = completeRuntimeGraph(root, nodes);
    return selectAffectedE2e([TUNER], inventory, manifest, completed.graph, (path) =>
        completed.opaqueSources.has(path)
    );
}

describe('affected E2E graph', () => {
    beforeAll(async () => {
        // The installed-library import and this file's mock factory are a
        // one-time cost per worker (~150-320 ms measured). Paying it inside
        // the first case's deadline lets a cold hosted runner alone time the
        // case out (#5290).
        await import('dependency-cruiser');
    });

    it('follows transitive file consumers but stops at the exact composition shell', () => {
        expect(selectAffectedE2e([TUNER], inventory, manifest, graph)).toEqual({
            kind: 'narrow',
            specs: [MIXED_SPEC, NEW_SPEC, TUNER_SPEC],
            browserAi: false,
            owners: ['Tuner'],
        });
        expect(selectAffectedE2e([CRUST], inventory, manifest, graph)).toEqual({
            kind: 'narrow',
            specs: [CRUST_SPEC, MIXED_SPEC, NEW_SPEC],
            browserAi: false,
            owners: ['Crust'],
        });
    });

    it('handles cycles and unions direct mixed feature changes', () => {
        const cycle: SourceNode[] = [
            ...graph,
            { source: 'src/modules/Tuner/presentations/views/TunerPart.tsx', dependencies: [{ resolved: PANEL }] },
        ];
        cycle[1] = { source: PANEL, dependencies: [{ resolved: TUNER }, { resolved: cycle.at(-1)!.source }] };
        expect(selectAffectedE2e([TUNER, CRUST], inventory, manifest, cycle)).toEqual({
            kind: 'narrow',
            specs: [CRUST_SPEC, MIXED_SPEC, NEW_SPEC, TUNER_SPEC],
            browserAi: false,
            owners: ['Crust', 'Tuner'],
        });
    });

    it('widens direct composition edits and non-composition cross-domain consumers', () => {
        expect(selectAffectedE2e([SHELL], inventory, manifest, graph).kind).toBe('full');
        const crossDomain: SourceNode[] = [
            ...graph,
            { source: 'src/modules/AudioEngine/useCases/readTuner.ts', dependencies: [{ resolved: TUNER }] },
        ];
        expect(selectAffectedE2e([TUNER], inventory, manifest, crossDomain).kind).toBe('full');
    });

    it('widens when an unlinked shared runtime importer can load the changed feature', () => {
        const sharedLoader = 'src/components/SharedRuntimeLoader.ts';
        const hiddenConsumer: SourceNode[] = [
            ...graph.map((node) => {
                if (node.source === CRUST) {
                    return { ...node, dependencies: [{ resolved: sharedLoader }] };
                }
                return node;
            }),
            { source: sharedLoader, dependencies: [] },
        ];
        expect(
            selectAffectedE2e([TUNER], inventory, manifest, hiddenConsumer, (path) => path === sharedLoader)
        ).toEqual({
            kind: 'full',
            reason: 'opaque runtime dependency: src/components/SharedRuntimeLoader.ts',
        });
    });

    it('finds a computed import in a shared loader even when the file graph omits its target', () => {
        const sharedLoader = 'src/components/SharedRuntimeLoader.ts';
        const hiddenConsumer: SourceNode[] = [...graph, { source: sharedLoader, dependencies: [] }];
        withRuntimeSources(
            hiddenConsumer,
            {
                [sharedLoader]: 'export async function load(template: string) { return import(template); }',
            },
            (root) => {
                expect(selectCompleted(root, hiddenConsumer)).toEqual({
                    kind: 'full',
                    reason: `opaque runtime dependency: ${sharedLoader}`,
                });
            }
        );
    });

    it('allows a fixed public module only after its graph node and source are inspected', () => {
        const loader = 'src/modules/AudioEngine/repositories/loadDecoder.ts';
        const asset = 'public/wasm/decoder.js';
        const nodes: SourceNode[] = [
            ...graph,
            { source: loader, dependencies: [] },
            { source: asset, dependencies: [] },
        ];
        const source = `export async function load() {
            const decoderUrl = new URL('wasm/decoder.js', globalThis.location.href).href;
            return import(/* @vite-ignore */ decoderUrl);
        }`;
        withRuntimeSources(nodes, { [loader]: source, [asset]: 'export const decoder = true;' }, (root) => {
            expect(selectCompleted(root, nodes)).toMatchObject({ kind: 'narrow', owners: ['Tuner'] });
        });
        const productImport: SourceNode[] = nodes.map((node) =>
            node.source === asset ? { ...node, dependencies: [{ resolved: TUNER }] } : node
        );
        withRuntimeSources(productImport, { [loader]: source, [asset]: `import '../../${TUNER}';` }, (root) => {
            expect(() => completeRuntimeGraph(root, productImport)).toThrow(
                'public runtime asset imports product source'
            );
        });
        const bridge = 'config/runtime/bridge.ts';
        const bridged: SourceNode[] = [
            ...nodes.map((node) => (node.source === asset ? { ...node, dependencies: [{ resolved: bridge }] } : node)),
            { source: bridge, dependencies: [{ resolved: TUNER }] },
        ];
        withRuntimeSources(
            bridged,
            {
                [loader]: source,
                [asset]: "import '../../config/runtime/bridge';",
                [bridge]: `import '../../${TUNER}';`,
            },
            (root) => {
                expect(() => completeRuntimeGraph(root, bridged)).toThrow(
                    'public runtime asset imports product source: config/runtime/bridge.ts'
                );
            }
        );
        withRuntimeSources(nodes, { [loader]: source, [asset]: 'export const decoder = import(template);' }, (root) => {
            expect(selectCompleted(root, nodes)).toMatchObject({ kind: 'full' });
        });
        withRuntimeSources(
            nodes,
            {
                [loader]: `const URL = class {};
                ${source}`,
                [asset]: 'export const decoder = true;',
            },
            (root) => {
                expect(selectCompleted(root, nodes)).toMatchObject({ kind: 'full' });
            }
        );
    });

    it.each(['explicit', 'implicit', 'inherited'])(
        'rejects shadowed imports and qualified Workers in the installed graph loader (%s alias declaration)',
        async (baseUrl) => {
            observedGraphs.length = 0;
            observedRoots.length = 0;
            const root = mkdtempSync(join(tmpdir(), 'sourdaw-shadowed-runtime-'));
            observedRoots.push(root);
            const sharedLoader = 'src/components/SharedRuntimeLoader.ts';
            const sources: Record<string, string> = {
                [TUNER]: 'export const tuner = 1;',
                [PANEL]: "import { tuner } from '../components/TunerDisplay'; export const panel = tuner;",
                [BARREL]: "export * from './TunerPanel';",
                [CRUST]: `import { load } from '../../../../components/SharedRuntimeLoader';
                export const crust = load('/src/modules/Tuner/presentations/components/TunerDisplay.tsx');`,
                [CRUST_BARREL]: "export * from './CrustPanel';",
                [SHELL]: "import '#/modules/Tuner/presentations/views'; import '#/modules/Crust/presentations/views';",
                [sharedLoader]: `export async function load(template: string) {
                const decoderUrl = new URL('wasm/decoder.js', globalThis.location.href).href;
                return ((decoderUrl: string) => import(decoderUrl))(template);
            }`,
                'public/wasm/decoder.js': 'export const decoder = true;',
            };
            try {
                for (const [path, content] of Object.entries(sources)) {
                    const file = join(root, path);
                    mkdirSync(dirname(file), { recursive: true });
                    writeFileSync(file, content);
                }
                mkdirSync(join(root, 'scripts'), { recursive: true });
                writeFileSync(join(root, 'scripts/e2eSuiteOwners.json'), JSON.stringify(manifest));
                const aliases = { '#/*': ['./src/*'] };
                if (baseUrl === 'inherited') {
                    mkdirSync(join(root, 'config'));
                    writeFileSync(
                        join(root, 'config/base.json'),
                        JSON.stringify({
                            compilerOptions: { paths: { '#/*': ['../src/*'] } },
                        })
                    );
                    writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ extends: './config/base.json' }));
                } else {
                    writeFileSync(
                        join(root, 'tsconfig.json'),
                        JSON.stringify({
                            compilerOptions:
                                baseUrl === 'explicit'
                                    ? { paths: { '#/*': [join(root, 'src/*')] } }
                                    : { paths: aliases },
                        })
                    );
                }
                expect(await loadAffectedE2e(root, [TUNER], inventory)).toEqual({
                    kind: 'full',
                    reason: `opaque runtime dependency: ${sharedLoader}`,
                });
                expect(observedGraphs).toHaveLength(1);
                expect(observedSources()).toEqual(Object.keys(sources).sort());
                expect(observedDependencies(SHELL)).toEqual([BARREL, CRUST_BARREL].sort());
                writeFileSync(
                    join(root, sharedLoader),
                    `export function load(template: string) {
                    return new globalThis.Worker(template, { type: 'module' });
                }`
                );
                expect(await loadAffectedE2e(root, [TUNER], inventory)).toEqual({
                    kind: 'full',
                    reason: `opaque runtime dependency: ${sharedLoader}`,
                });
                expect(observedGraphs).toHaveLength(2);
                expect(observedSources()).toEqual(Object.keys(sources).sort());
                expect(observedDependencies(SHELL)).toEqual([BARREL, CRUST_BARREL].sort());
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        },
        30_000
    );

    it.each(['TS_NODE_PROJECT', 'TS_NODE_BASEURL'] as const)(
        'refuses caller %s alias overrides before they can omit a cross-owner consumer',
        async (override) => {
            const root = mkdtempSync(join(tmpdir(), 'sourdaw-requested-alias-'));
            const shadow = mkdtempSync(join(tmpdir(), 'sourdaw-shadow-alias-'));
            const originalProject = process.env.TS_NODE_PROJECT;
            const originalBaseUrl = process.env.TS_NODE_BASEURL;
            observedGraphs.length = 0;
            observedRoots.length = 0;
            try {
                observedRoots.push(root);
                delete process.env.TS_NODE_PROJECT;
                delete process.env.TS_NODE_BASEURL;
                const sources = {
                    [TUNER]: 'export const tuner = 1;',
                    [PANEL]: "import { tuner } from '../components/TunerDisplay'; export const panel = tuner;",
                    [BARREL]: "export * from './TunerPanel';",
                    [CRUST]: `import { tuner } from '#/modules/Tuner/presentations/components/TunerDisplay';
                        export const crust = tuner;`,
                    [CRUST_BARREL]: "export * from './CrustPanel';",
                    [SHELL]:
                        "import '#/modules/Tuner/presentations/views'; import '#/modules/Crust/presentations/views';",
                    'public/wasm/decoder.js': 'export const decoder = true;',
                };
                for (const [path, content] of Object.entries(sources)) {
                    mkdirSync(dirname(join(root, path)), { recursive: true });
                    writeFileSync(join(root, path), content);
                    mkdirSync(dirname(join(shadow, path)), { recursive: true });
                    writeFileSync(join(shadow, path), 'export const shadow = 0;');
                }
                mkdirSync(join(root, 'scripts'));
                writeFileSync(join(root, 'scripts/e2eSuiteOwners.json'), JSON.stringify(manifest));
                const config = { compilerOptions: { paths: { '#/*': ['./src/*'] } } };
                writeFileSync(join(root, 'tsconfig.json'), JSON.stringify(config));
                writeFileSync(join(shadow, 'tsconfig.json'), JSON.stringify(config));
                expect(await loadAffectedE2e(root, [TUNER], inventory)).toEqual({
                    kind: 'narrow',
                    specs: [CRUST_SPEC, MIXED_SPEC, NEW_SPEC, TUNER_SPEC],
                    browserAi: false,
                    owners: ['Crust', 'Tuner'],
                });
                expect(observedDependencies(CRUST)).toEqual([TUNER]);

                observedGraphs.length = 0;
                process.env[override] = override === 'TS_NODE_PROJECT' ? join(shadow, 'tsconfig.json') : shadow;
                expect(await loadAffectedE2e(root, [TUNER], inventory)).toEqual({
                    kind: 'full',
                    reason: 'caller TypeScript alias override prevents proving the requested root',
                });
                expect(observedGraphs).toEqual([]);
            } finally {
                if (originalProject === undefined) {
                    delete process.env.TS_NODE_PROJECT;
                } else {
                    process.env.TS_NODE_PROJECT = originalProject;
                }
                if (originalBaseUrl === undefined) {
                    delete process.env.TS_NODE_BASEURL;
                } else {
                    process.env.TS_NODE_BASEURL = originalBaseUrl;
                }
                rmSync(root, { recursive: true, force: true });
                rmSync(shadow, { recursive: true, force: true });
            }
        },
        30_000
    );

    it('resolves inherited implicit aliases from their real declaring base before narrowing', async () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-inherited-alias-base-'));
        observedGraphs.length = 0;
        observedRoots.length = 0;
        observedRoots.push(root);
        const sources = {
            [TUNER]: 'export const tuner = true;',
            [SHELL]: "import '../../../Tuner/presentations/components/TunerDisplay';",
            'src/entry.ts': "import { target } from '#/target'; export const entry = target;",
            'src/target.ts': 'export const target = false;',
            'config/src/target.ts': `import { tuner } from '../../${TUNER}'; export const target = tuner;`,
        };
        try {
            for (const [path, content] of Object.entries(sources)) {
                mkdirSync(dirname(join(root, path)), { recursive: true });
                writeFileSync(join(root, path), content);
            }
            mkdirSync(join(root, 'public'));
            mkdirSync(join(root, 'scripts'));
            writeFileSync(join(root, 'scripts/e2eSuiteOwners.json'), JSON.stringify(manifest));
            writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ extends: './config/base.json' }));
            writeFileSync(
                join(root, 'config/base.json'),
                JSON.stringify({
                    compilerOptions: { paths: { '#/*': ['./src/*'] } },
                })
            );
            expect(await loadAffectedE2e(root, [TUNER], inventory)).toEqual({
                kind: 'full',
                reason: 'shared or uncurated consumer: config/src/target.ts',
            });
            expect(observedGraphs).toHaveLength(1);
            expect(observedDependencies('src/entry.ts')).toEqual(['config/src/target.ts']);
            expect(observedDependencies('config/src/target.ts')).toEqual([TUNER]);
            writeFileSync(join(root, 'config/src/target.ts'), 'export const target = true;');
            expect(await loadAffectedE2e(root, [TUNER], inventory)).toEqual({
                kind: 'narrow',
                specs: [MIXED_SPEC, NEW_SPEC, TUNER_SPEC],
                browserAi: false,
                owners: ['Tuner'],
            });
            expect(observedGraphs).toHaveLength(2);
            expect(observedDependencies('src/entry.ts')).toEqual(['config/src/target.ts']);
            expect(observedDependencies('config/src/target.ts')).toEqual([]);
            writeFileSync(
                join(root, 'config/src/target.ts'),
                'export const target = () => import(globalThis.runtimeModule);'
            );
            expect(await loadAffectedE2e(root, [TUNER], inventory)).toEqual({
                kind: 'full',
                reason: 'opaque runtime dependency: config/src/target.ts',
            });
            expect(observedGraphs).toHaveLength(3);
            expect(observedDependencies('src/entry.ts')).toEqual(['config/src/target.ts']);
            writeFileSync(
                join(root, 'src/entry.ts'),
                "import worker from '#/target?worker'; export const target = worker;"
            );
            writeFileSync(join(root, 'config/src/target.ts'), "export { tuner as target } from './shared';");
            writeFileSync(join(root, 'config/src/shared.ts'), `export { tuner } from '../../${TUNER}';`);
            const runtime = await loadRuntimeGraph(root);
            expect(runtime.kind).toBe('graph');
            if (runtime.kind !== 'graph') throw new Error(runtime.reason);
            expect([...offPageSources(runtime)]).toEqual(
                expect.arrayContaining(['config/src/target.ts', 'config/src/shared.ts', TUNER])
            );
            expect(observedGraphs).toHaveLength(4);
            expect(observedDependencies('src/entry.ts')).toEqual(['config/src/target.ts']);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    }, 30_000);

    it('refuses a resolved runtime script outside the requested root before parsing it', () => {
        const parent = mkdtempSync(join(tmpdir(), 'sourdaw-runtime-root-boundary-'));
        const root = join(parent, 'requested');
        try {
            mkdirSync(root);
            writeFileSync(join(parent, 'sibling.ts'), 'export const sibling = true;');
            expect(() => completeRuntimeGraph(root, [{ source: '../sibling.ts', dependencies: [] }])).toThrow(
                'runtime graph source leaves requested root: ../sibling.ts'
            );
        } finally {
            rmSync(parent, { recursive: true, force: true });
        }
    });

    it.each(['missing', 'malformed', 'invalid', 'missing-extends'])(
        'fails closed before graph traversal for %s TypeScript configuration',
        async (configuration) => {
            const root = mkdtempSync(join(tmpdir(), 'sourdaw-invalid-graph-config-'));
            observedGraphs.length = 0;
            observedRoots.length = 0;
            try {
                mkdirSync(join(root, 'scripts'));
                mkdirSync(join(root, 'src'));
                mkdirSync(join(root, 'public'));
                writeFileSync(join(root, 'src/entry.ts'), 'export const entry = true;');
                writeFileSync(join(root, 'scripts/e2eSuiteOwners.json'), JSON.stringify(manifest));
                if (configuration !== 'missing') {
                    let config = '{';
                    if (configuration === 'invalid') {
                        config = JSON.stringify({ compilerOptions: { module: 'invalid-module' } });
                    } else if (configuration === 'missing-extends') {
                        config = JSON.stringify({ extends: './missing.json' });
                    }
                    writeFileSync(join(root, 'tsconfig.json'), config);
                }
                expect(await loadAffectedE2e(root, [TUNER], inventory)).toMatchObject({ kind: 'full' });
                expect(observedGraphs).toEqual([]);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        }
    );

    it('widens unknown shared Worker targets but retains graph-represented literal targets', () => {
        const sharedWorker = 'src/components/SharedWorkerLoader.ts';
        const unknown: SourceNode[] = [...graph, { source: sharedWorker, dependencies: [] }];
        withRuntimeSources(unknown, { [sharedWorker]: 'new Worker(runtimeUrl);' }, (root) => {
            expect(selectCompleted(root, unknown)).toEqual({
                kind: 'full',
                reason: `opaque runtime dependency: ${sharedWorker}`,
            });
        });
        for (const constructor of ['self.Worker', 'window.Worker', "globalThis['Worker']"]) {
            withRuntimeSources(unknown, { [sharedWorker]: `new ${constructor}(runtimeUrl);` }, (root) => {
                expect(selectCompleted(root, unknown)).toEqual({
                    kind: 'full',
                    reason: `opaque runtime dependency: ${sharedWorker}`,
                });
            });
        }
        const host = 'src/modules/Crust/presentations/views/CrustWorkerHost.tsx';
        const worker = 'src/modules/Crust/presentations/views/crustWorker.ts';
        const known: SourceNode[] = [
            ...graph,
            { source: host, dependencies: [] },
            { source: worker, dependencies: [] },
        ];
        withRuntimeSources(
            known,
            {
                [host]: `new Worker(new URL('./crustWorker.ts', import.meta.url), { type: 'module' });`,
                [worker]: 'export const ready = true;',
            },
            (root) => {
                expect(selectCompleted(root, known)).toMatchObject({ kind: 'narrow', owners: ['Tuner'] });
                const completed = completeRuntimeGraph(root, known);
                expect(completed.graph.find((node) => node.source === host)?.dependencies).toContainEqual({
                    resolved: worker,
                });
            }
        );
        withRuntimeSources(
            known,
            {
                [host]: `const Worker = class {};
                    new Worker(new URL('./crustWorker.ts', import.meta.url));`,
                [worker]: 'export const ready = true;',
            },
            (root) => {
                expect(selectCompleted(root, known)).toEqual({
                    kind: 'full',
                    reason: `opaque runtime dependency: ${host}`,
                });
            }
        );
        withRuntimeSources(
            known,
            {
                [host]: `const URL = class {};
                    new Worker(new URL('./crustWorker.ts', import.meta.url));`,
                [worker]: 'export const ready = true;',
            },
            (root) => {
                expect(selectCompleted(root, known).kind).toBe('full');
            }
        );
        const queryWorker = `${worker}?mode=live`;
        const unsupported: SourceNode[] = [
            ...graph,
            { source: host, dependencies: [] },
            { source: queryWorker, dependencies: [] },
        ];
        withRuntimeSources(
            unsupported,
            {
                [host]: `new Worker(new URL('./crustWorker.ts?mode=live', import.meta.url), { type: 'module' });`,
                [queryWorker]: 'export const ready = true;',
            },
            (root) => {
                expect(selectCompleted(root, unsupported).kind).toBe('full');
            }
        );
    });

    it('widens unknown sources, missing graph nodes, and unresolved internal imports', () => {
        expect(
            selectAffectedE2e(['src/modules/Other/presentations/views/New.tsx'], inventory, manifest, graph).kind
        ).toBe('full');
        expect(
            selectAffectedE2e(['src/modules/Tuner/presentations/views/Missing.tsx'], inventory, manifest, graph).kind
        ).toBe('full');
        const unresolved: SourceNode[] = [
            ...graph,
            {
                source: 'src/modules/Other/useCases/new.ts',
                dependencies: [
                    {
                        module: '#/modules/Tuner/useCases/setDisplayMode',
                        resolved: '#/modules/Tuner/useCases/setDisplayMode',
                        couldNotResolve: true,
                    },
                ],
            },
        ];
        expect(selectAffectedE2e([TUNER], inventory, manifest, unresolved).kind).toBe('full');
        const malformed = [
            ...graph,
            { source: 'src/modules/Other/useCases/new.ts', dependencies: [{ resolved: 123 }] },
        ];
        expect(selectAffectedE2e([TUNER], inventory, manifest, malformed as unknown as SourceNode[]).kind).toBe('full');
    });

    it('widens malformed, missing, or duplicate metadata rather than dropping a suite', () => {
        expect(
            selectAffectedE2e(
                [TUNER],
                inventory,
                { ...manifest, entries: [...manifest.entries, manifest.entries[0]] },
                graph
            ).kind
        ).toBe('full');
        expect(
            selectAffectedE2e(
                [TUNER],
                inventory,
                { ...manifest, entries: [{ spec: 'tests/e2e/missing.spec.ts', owners: ['Tuner'] }] },
                graph
            ).kind
        ).toBe('full');
        expect(
            selectAffectedE2e(
                [TUNER],
                inventory,
                { ...manifest, entries: [{ spec: TUNER_SPEC, owners: ['Unknown'] }] },
                graph
            ).kind
        ).toBe('full');
        expect(selectAffectedE2e([TUNER], inventory, null, graph).kind).toBe('full');
    });

    it('keeps an unowned BrowserAi proof selected and turns on hardware admission', () => {
        const unowned = {
            ...manifest,
            owners: ['Crust', 'Tuner'],
            entries: manifest.entries.filter((entry) => entry.spec !== AI_SPEC),
        };
        expect(selectAffectedE2e([TUNER], inventory, unowned, graph)).toMatchObject({
            kind: 'narrow',
            browserAi: true,
            specs: expect.arrayContaining([AI_SPEC]),
        });
    });
});
