import { describe, it, expect, vi, beforeEach } from 'vitest';

const DEVICE_ID = 'd1';

const { mockLevainStore } = vi.hoisted(() => ({
    mockLevainStore: {
        value: null as Record<
            string,
            { patch: { articulations: unknown[] }; currentArticulationDisplay: string }
        > | null,
        set: vi.fn(),
    },
}));

vi.mock('../../stores/levainStore', () => ({
    levainStore: mockLevainStore,
}));

vi.mock('../levainParamBridge/loadSamplesForInstrument', () => ({
    loadSamplesForInstrument: vi.fn(),
}));

vi.mock('../levainParamBridge/setLevainParamWithAudio', () => ({
    setLevainParamWithAudio: vi.fn(),
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
    });

    it('updates the store with the default patch and triggers sample load', () => {
        loadInstrument(DEVICE_ID, 'violin-1');

        expect(mockLevainStore.set).toHaveBeenCalled();
        expect(loadSamplesForInstrument).toHaveBeenCalledWith(DEVICE_ID, 'violin-1');
        // Forwards each engine param at least once
        expect(setLevainParamWithAudio).toHaveBeenCalledWith(DEVICE_ID, 'masterGain', expect.any(Number));
        expect(setLevainParamWithAudio).toHaveBeenCalledWith(DEVICE_ID, 'legato', expect.anything());
    });

    it('skips patch updates when the store is empty', () => {
        mockLevainStore.value = null;

        loadInstrument(DEVICE_ID, 'violin-1');

        expect(mockLevainStore.set).not.toHaveBeenCalled();
        // Sample load is still triggered
        expect(loadSamplesForInstrument).toHaveBeenCalledWith(DEVICE_ID, 'violin-1');
    });
});
