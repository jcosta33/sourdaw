import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hydrateModuleStoresFromProjectData } from '../hydrateModuleStoresFromProjectData';
import { type HydratableProjectData } from '../isHydratableProjectData';

const mocks = vi.hoisted(() => ({
    automationStoreSet: vi.fn(),
    markerStoreSet: vi.fn(),
    restoreAdjustmentLayerSnapshot: vi.fn(),
    replaceChordTrackState: vi.fn(),
    hydrateGrooveTemplates: vi.fn(),
    hydrateYeastState: vi.fn(),
    hydrateVcaGroups: vi.fn(),
    hydrateClipGainEnvelopes: vi.fn(),
    hydrateModulationState: vi.fn(),
    hydrateCvGateState: vi.fn(),
    setSidechainRoutes: vi.fn(),
    trackStoreSet: vi.fn(),
    restoreTransportSnapshot: vi.fn(),
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    markerStore: { set: mocks.markerStoreSet },
    trackStore: { set: mocks.trackStoreSet },
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    restoreAdjustmentLayerSnapshot: mocks.restoreAdjustmentLayerSnapshot,
    hydrateVcaGroups: mocks.hydrateVcaGroups,
    hydrateClipGainEnvelopes: mocks.hydrateClipGainEnvelopes,
}));

vi.mock('#/modules/Automation/useCases', () => ({
    hydrateModulationState: mocks.hydrateModulationState,
}));

vi.mock('#/modules/CvGate/useCases', () => ({
    hydrateCvGateState: mocks.hydrateCvGateState,
}));

vi.mock('#/modules/Automation/stores', () => ({
    automationStore: { set: mocks.automationStoreSet },
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    replaceChordTrackState: mocks.replaceChordTrackState,
    hydrateGrooveTemplates: mocks.hydrateGrooveTemplates,
}));

vi.mock('#/modules/Routing/useCases', () => ({
    setSidechainRoutes: mocks.setSidechainRoutes,
}));

vi.mock('#/modules/Transport/useCases', () => ({
    restoreTransportSnapshot: mocks.restoreTransportSnapshot,
}));

vi.mock('#/modules/Yeast/useCases', () => ({
    hydrateYeastState: mocks.hydrateYeastState,
}));

type HydratableProjectDataOverrides = Pick<
    HydratableProjectData,
    | 'adjustmentLayers'
    | 'automation'
    | 'chordTrack'
    | 'cvGate'
    | 'gainEnvelopes'
    | 'grooves'
    | 'markers'
    | 'modulation'
    | 'sidechainRoutes'
    | 'transport'
    | 'vcaGroups'
    | 'yeast'
>;

function createHydratableProjectData(overrides: HydratableProjectDataOverrides = {}): HydratableProjectData {
    return {
        version: 1,
        meta: {
            name: 'Project',
            createdAt: 0,
            updatedAt: 0,
            keyRoot: 0,
            scaleName: 'Major',
            tuning: { name: 'Equal temperament', frequencies: [] },
        },
        arrangement: { tracks: [] },
        ...overrides,
    };
}

describe('hydrateModuleStoresFromProjectData', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('delegates transport, adjustment layers, and routes to their owning modules', () => {
        const transport = {
            tempo: 128,
            timeSignatureNumerator: 4,
            timeSignatureDenominator: 4,
            loopStart: 0,
            loopEnd: 16,
            isLooping: true,
            metronomeEnabled: true,
            metronomeVolume: 0.7,
            punchInEnabled: true,
            punchInBeat: 2,
            punchOutBeat: 8,
            countInEnabled: true,
            countInBars: 2,
            preRollEnabled: true,
            preRollBars: 1,
            masterGain: 0.8,
        } satisfies NonNullable<HydratableProjectData['transport']>;
        const adjustmentLayers = {
            layers: [
                {
                    id: 'layer-1',
                    name: 'Master EQ',
                    effectType: 'eq',
                    parameters: [{ name: 'Low Cut', value: 80, min: 20, max: 500, unit: 'Hz' }],
                    affectedTrackIds: ['track-1'],
                    insertionIndex: 0,
                    regions: [],
                    enabled: true,
                    mix: 1,
                    color: '#66ccff',
                },
            ],
        } satisfies NonNullable<HydratableProjectData['adjustmentLayers']>;
        const sidechainRoutes = [
            {
                id: 'route-1',
                sourceTrackId: 'source',
                targetTrackId: 'target',
                targetDeviceId: 'device',
                targetParameterId: 'threshold',
                gain: 1,
            },
        ] satisfies NonNullable<HydratableProjectData['sidechainRoutes']>;

        hydrateModuleStoresFromProjectData(
            createHydratableProjectData({ transport, adjustmentLayers, sidechainRoutes })
        );

        expect(mocks.restoreTransportSnapshot).toHaveBeenCalledWith(transport);
        expect(mocks.restoreAdjustmentLayerSnapshot).toHaveBeenCalledWith(adjustmentLayers);
        expect(mocks.setSidechainRoutes).toHaveBeenCalledWith(sidechainRoutes);
    });

    it('preserves the absent-transport guard while delegating empty owner snapshots', () => {
        hydrateModuleStoresFromProjectData(createHydratableProjectData());

        expect(mocks.restoreTransportSnapshot).not.toHaveBeenCalled();
        expect(mocks.restoreAdjustmentLayerSnapshot).toHaveBeenCalledWith(undefined);
        expect(mocks.replaceChordTrackState).toHaveBeenCalledWith(undefined);
        expect(mocks.hydrateGrooveTemplates).toHaveBeenCalledWith({ templates: [], assignments: [] });
        expect(mocks.hydrateYeastState).toHaveBeenCalledWith(undefined);
        expect(mocks.setSidechainRoutes).toHaveBeenCalledWith([]);
    });

    it('forwards the device-keyed yeast racks to the Yeast module untouched', () => {
        // Issue #2422: the file carries one rack per Yeast device; hydration
        // must hand the whole device-keyed section to the Yeast module, which
        // writes each rack under its own device id.
        const yeast = {
            racks: {
                'device-a': {
                    processors: [
                        {
                            id: 'up',
                            type: 'transposer' as const,
                            name: 'Up',
                            bypassed: false,
                            params: { semitones: 12 },
                        },
                    ],
                },
                'device-b': { processors: [] },
            },
        } satisfies NonNullable<HydratableProjectData['yeast']>;

        hydrateModuleStoresFromProjectData(createHydratableProjectData({ yeast }));

        expect(mocks.hydrateYeastState).toHaveBeenCalledWith(yeast);
    });

    it('routes every persisted mix-state field to the module that owns it', () => {
        const vcaGroups = [{ id: 'vca-drums', name: 'Drums', gain: 0.5, muted: false, trackIds: ['track-kick'] }];
        const gainEnvelopes = [
            { clipId: 'clip-vox', enabled: true, points: [{ id: 'point-a', beatOffset: 2, gainDb: -4 }] },
        ];
        const modulation = {
            modulators: [
                {
                    id: 'mod-1',
                    name: 'Filter LFO',
                    trackId: 'track-bass',
                    kind: 'lfo',
                    config: { kind: 'lfo', waveform: 'sine', rate: 1, sync: false, phase: 0, depth: 1 },
                    mappings: [],
                    enabled: true,
                },
            ],
        };
        const cvGate = {
            outputs: [],
            voltageStandard: 'hz-per-volt',
            clockDivision: 2,
            triggerPulseMs: 5,
            gateThreshold: 1,
        };

        hydrateModuleStoresFromProjectData(
            createHydratableProjectData({ vcaGroups, gainEnvelopes, modulation, cvGate })
        );

        expect(mocks.hydrateVcaGroups).toHaveBeenCalledWith(vcaGroups);
        expect(mocks.hydrateClipGainEnvelopes).toHaveBeenCalledWith(gainEnvelopes);
        expect(mocks.hydrateModulationState).toHaveBeenCalledWith(modulation);
        expect(mocks.hydrateCvGateState).toHaveBeenCalledWith(cvGate);
    });

    // Presence pin for the delegation above: a file with no mix state must still
    // reach every owner, because each owner's clear-on-absent is what stops the
    // previous project's VCA masters from attenuating this one's tracks.
    it('still reaches every mix-state owner when the file carries none', () => {
        hydrateModuleStoresFromProjectData(createHydratableProjectData());

        expect(mocks.hydrateVcaGroups).toHaveBeenCalledWith(undefined);
        expect(mocks.hydrateClipGainEnvelopes).toHaveBeenCalledWith(undefined);
        expect(mocks.hydrateModulationState).toHaveBeenCalledWith(undefined);
        expect(mocks.hydrateCvGateState).toHaveBeenCalledWith(undefined);
    });

    it('hydrates persisted chord-track state through the owning MIDI use case', () => {
        const chordTrack = {
            enabled: true,
            events: [{ id: 'chord-1', beat: 0, root: 9, quality: 'minor', duration: 4 }],
        } satisfies NonNullable<HydratableProjectData['chordTrack']>;

        hydrateModuleStoresFromProjectData(createHydratableProjectData({ chordTrack }));

        expect(mocks.replaceChordTrackState).toHaveBeenCalledWith(chordTrack);
    });

    it('hydrates persisted groove state through the owning MIDI use case', () => {
        const grooves = {
            templates: [
                {
                    id: 'persisted-groove',
                    name: 'Persisted groove',
                    schemaVersion: 1,
                    subdivision: '1/16',
                    slots: [],
                    provenance: { type: 'user', sourceId: 'project-load' },
                },
            ],
            assignments: [],
        } satisfies NonNullable<HydratableProjectData['grooves']>;

        hydrateModuleStoresFromProjectData(createHydratableProjectData({ grooves }));

        expect(mocks.hydrateGrooveTemplates).toHaveBeenCalledWith(grooves);
    });

    it('hydrates durable Yeast processor identities through the owning use case', () => {
        const yeast = {
            processors: [{ id: 'durable-groove', type: 'groove', name: 'Groove', bypassed: false }],
        } satisfies NonNullable<HydratableProjectData['yeast']>;

        hydrateModuleStoresFromProjectData(createHydratableProjectData({ yeast }));

        expect(mocks.hydrateYeastState).toHaveBeenCalledWith(yeast);
    });

    it('leaves active arrangement and automation stores to the active-snapshot hydrator', () => {
        hydrateModuleStoresFromProjectData(
            createHydratableProjectData({
                adjustmentLayers: undefined,
                automation: { lanes: [] },
                markers: [],
                sidechainRoutes: undefined,
                transport: undefined,
            })
        );

        expect(mocks.trackStoreSet).not.toHaveBeenCalled();
        expect(mocks.markerStoreSet).not.toHaveBeenCalled();
        expect(mocks.automationStoreSet).not.toHaveBeenCalled();
    });
});
