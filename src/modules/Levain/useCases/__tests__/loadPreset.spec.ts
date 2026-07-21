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

vi.mock('../levainParamBridge/setLevainParamWithAudio', () => ({
    setLevainParamWithAudio: vi.fn(),
}));

vi.mock('../levainParamBridge/levainBridgeDependencies', () => ({
    levainBridgeDependencies: {
        resolveEligibleDeviceWriteTarget: mockResolveEligibleDeviceWriteTarget,
    },
}));

import { loadSamplesForInstrument } from '../levainParamBridge/loadSamplesForInstrument';
import { setLevainParamWithAudio } from '../levainParamBridge/setLevainParamWithAudio';
import { loadInstrument } from '../loadPreset';

describe('loadInstrument', () => {
    beforeEach(() => {
        mockLevainStore.value = {
            [DEVICE_ID]: { patch: { articulations: [] }, currentArticulationDisplay: '' },
        };
        mockLevainStore.set.mockClear();
        vi.mocked(setLevainParamWithAudio).mockClear();
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
        // Forwards each engine param at least once
        expect(setLevainParamWithAudio).toHaveBeenCalledWith(DEVICE_ID, 'masterGain', expect.any(Number));
        expect(setLevainParamWithAudio).toHaveBeenCalledWith(DEVICE_ID, 'legato', expect.anything());
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
            expect(setLevainParamWithAudio).not.toHaveBeenCalled();
            expect(loadSamplesForInstrument).not.toHaveBeenCalled();
        }
    );
});
