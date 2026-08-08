import { describe, it, expect, vi, beforeEach } from 'vitest';

const DEVICE_ID = 'd1';

type ResolveEligibleDeviceWriteTarget = typeof import('#/modules/Arrangement/stores').resolveEligibleDeviceWriteTarget;

const { mockLevainStore, mockResolveEligibleDeviceWriteTarget } = vi.hoisted(() => ({
    mockLevainStore: {
        value: null as Record<
            string,
            { patch: { articulations: unknown[] }; currentArticulationDisplay: string }
        > | null,
        set: vi.fn(),
    },
    mockResolveEligibleDeviceWriteTarget: vi.fn<ResolveEligibleDeviceWriteTarget>(),
}));

vi.mock('../../stores/levainStore', () => ({
    levainStore: mockLevainStore,
    defaultLevainState: {
        patch: { articulations: [], currentArticulation: 'long' },
        uiLevel: 1,
        engineReady: false,
        sampleLoadProgress: null,
        activeVoices: 0,
        peakL: 0,
        peakR: 0,
        currentArticulationDisplay: 'Long',
    },
}));

vi.mock('../levainParamBridge/loadSamplesForInstrument', () => ({
    loadSamplesForInstrument: vi.fn(),
}));

vi.mock('../levainParamBridge/applyPatchToEngine', () => ({
    applyPatchToEngine: vi.fn(),
}));

vi.mock('../levainParamBridge/levainBridgeDependencies', () => ({
    levainBridgeDependencies: {
        resolveEligibleDeviceWriteTarget: mockResolveEligibleDeviceWriteTarget,
    },
}));

import { applyPatchToEngine } from '../levainParamBridge/applyPatchToEngine';
import { loadSamplesForInstrument } from '../levainParamBridge/loadSamplesForInstrument';
import { loadInstrument } from '../loadPreset';

describe('loadInstrument', () => {
    beforeEach(() => {
        mockLevainStore.value = {
            [DEVICE_ID]: { patch: { articulations: [] }, currentArticulationDisplay: '' },
        };
        mockLevainStore.set.mockClear();
        vi.mocked(applyPatchToEngine).mockClear();
        vi.mocked(loadSamplesForInstrument).mockClear();
        mockResolveEligibleDeviceWriteTarget.mockReset();
        mockResolveEligibleDeviceWriteTarget.mockImplementation((deviceId) => ({
            status: 'eligible',
            trackId: 'track-1',
            deviceId,
        }));
    });

    it('updates the store with the default patch and triggers sample load', () => {
        loadInstrument(DEVICE_ID, 'violin-1');

        expect(mockLevainStore.set).toHaveBeenCalled();
        expect(loadSamplesForInstrument).toHaveBeenCalledWith(DEVICE_ID, 'violin-1');
    });

    it('forwards the whole patch, not the four fields it used to hand-list', () => {
        // This spec previously pinned `masterGain` and `legato` reaching the engine
        // individually, which is exactly the subset that left the engine holding the
        // previous instrument's mic mix and articulation (audit M-131). Asserting the
        // fields the old list omitted is what makes it a regression guard rather than
        // a restatement of the call it observes.
        loadInstrument(DEVICE_ID, 'cello');

        expect(applyPatchToEngine).toHaveBeenCalledWith(
            DEVICE_ID,
            expect.objectContaining({
                instrumentId: 'cello',
                currentArticulation: 'sustain',
                micPositions: expect.arrayContaining([expect.objectContaining({ type: 'close', volume: 0.8 })]),
            })
        );
    });

    it('seeds the store from defaults when the device entry is missing', () => {
        mockLevainStore.value = null;

        loadInstrument(DEVICE_ID, 'violin-1');

        // The patch must reach the store even when no prior entry existed —
        // the previous early-return left the patch unapplied and silenced
        // freshly-added Levain devices.
        expect(mockLevainStore.set).toHaveBeenCalled();
        expect(loadSamplesForInstrument).toHaveBeenCalledWith(DEVICE_ID, 'violin-1');
    });

    it.each(['missing', 'ineligible'] as const)(
        'rejects owner status %s before store, parameter, or sample-load effects',
        (status) => {
            mockResolveEligibleDeviceWriteTarget.mockReturnValue({ status });

            loadInstrument(DEVICE_ID, 'violin-1');

            expect(mockLevainStore.set).not.toHaveBeenCalled();
            expect(applyPatchToEngine).not.toHaveBeenCalled();
            expect(loadSamplesForInstrument).not.toHaveBeenCalled();
        }
    );
});
