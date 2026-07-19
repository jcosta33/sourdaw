import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hydrateModuleStoresFromProjectData } from '../hydrateModuleStoresFromProjectData';
import { type HydratableProjectData } from '../isHydratableProjectData';

const mocks = vi.hoisted(() => ({
    automationStoreSet: vi.fn(),
    markerStoreSet: vi.fn(),
    restoreAdjustmentLayerSnapshot: vi.fn(),
    hydrateGrooveTemplates: vi.fn(),
    hydrateYeastState: vi.fn(),
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
}));

vi.mock('#/modules/Automation/stores', () => ({
    automationStore: { set: mocks.automationStoreSet },
}));

vi.mock('#/modules/MIDI/useCases', () => ({
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
    'adjustmentLayers' | 'automation' | 'grooves' | 'markers' | 'sidechainRoutes' | 'transport' | 'yeast'
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
        expect(mocks.hydrateGrooveTemplates).toHaveBeenCalledWith({ templates: [], assignments: [] });
        expect(mocks.hydrateYeastState).toHaveBeenCalledWith(undefined);
        expect(mocks.setSidechainRoutes).toHaveBeenCalledWith([]);
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
            uiLevel: 2,
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
