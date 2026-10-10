import { describe, expect, it } from 'vitest';

import { selectAffectedE2e, type SourceNode } from '../e2eAffectedGraph';

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
