import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { completeRuntimeGraph, selectAffectedE2e, type SourceNode } from '../e2eAffectedGraph';

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
    });

    it('widens unknown shared Worker targets but retains graph-represented literal targets', () => {
        const sharedWorker = 'src/components/SharedWorkerLoader.ts';
        const unknown: SourceNode[] = [...graph, { source: sharedWorker, dependencies: [] }];
        withRuntimeSources(unknown, { [sharedWorker]: 'new Worker(runtimeUrl);' }, (root) => {
            expect(selectCompleted(root, unknown)).toEqual({
                kind: 'full',
                reason: `opaque runtime dependency: ${sharedWorker}`,
            });
        });
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
