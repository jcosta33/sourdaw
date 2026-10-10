import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { completeRuntimeGraph, loadAffectedE2e, selectAffectedE2e, type SourceNode } from '../e2eAffectedGraph';

const observedGraphs = vi.hoisted(() => new Array<string>());

vi.mock('dependency-cruiser', async (importOriginal) => {
    const actual = await importOriginal<typeof import('dependency-cruiser')>();
    return {
        ...actual,
        cruise: async (...args: Parameters<typeof actual.cruise>) => {
            const result = await actual.cruise(...args);
            if (typeof result.output === 'string') {
                observedGraphs.push(result.output);
            }
            return result;
        },
    };
});

function observedModules(): unknown[] {
    const output = observedGraphs.at(-1);
    if (output === undefined) {
        throw new Error('installed cruise did not emit a graph');
    }
    const parsed: unknown = JSON.parse(output);
    if (typeof parsed !== 'object' || parsed === null || !('modules' in parsed) || !Array.isArray(parsed.modules)) {
        throw new Error('installed cruise emitted an invalid graph');
    }
    return parsed.modules;
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
const CRUST_SPEC = 'tests/e2e/crustCeilingTestId.spec.ts';
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
        'rejects shadowed imports and qualified Workers in the installed graph loader (%s baseUrl)',
        async (baseUrl) => {
            observedGraphs.length = 0;
            const root = mkdtempSync(join(tmpdir(), 'sourdaw-shadowed-runtime-'));
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
                            compilerOptions: { baseUrl: '..', paths: aliases },
                        })
                    );
                    writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ extends: './config/base.json' }));
                } else {
                    writeFileSync(
                        join(root, 'tsconfig.json'),
                        JSON.stringify({
                            compilerOptions:
                                baseUrl === 'explicit' ? { baseUrl: '.', paths: aliases } : { paths: aliases },
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

    it.each(['missing', 'malformed', 'invalid', 'missing-extends'])(
        'fails closed before graph traversal for %s TypeScript configuration',
        async (configuration) => {
            const root = mkdtempSync(join(tmpdir(), 'sourdaw-invalid-graph-config-'));
            observedGraphs.length = 0;
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
