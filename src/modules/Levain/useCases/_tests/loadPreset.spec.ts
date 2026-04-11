import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../stores/levainStore', () => ({
    levainStore: {
        value: { patch: { articulations: [] }, currentArticulationDisplay: '' },
        set: vi.fn(),
    },
}));

vi.mock('../levainParamBridge/loadSamplesForInstrument', () => ({
    loadSamplesForInstrument: vi.fn(),
}));

vi.mock('../levainParamBridge/setLevainParamWithAudio', () => ({
    setLevainParamWithAudio: vi.fn(),
}));

import { loadInstrument } from '../loadPreset';
import { levainStore } from '../../stores/levainStore';
import { setLevainParamWithAudio } from '../levainParamBridge/setLevainParamWithAudio';
import { loadSamplesForInstrument } from '../levainParamBridge/loadSamplesForInstrument';

describe('loadInstrument', () => {
    beforeEach(() => {
        vi.mocked(levainStore.set).mockClear();
        vi.mocked(setLevainParamWithAudio).mockClear();
        vi.mocked(loadSamplesForInstrument).mockClear();
    });

    it('updates the store with the default patch and triggers sample load', () => {
        loadInstrument('violin-1');

        expect(levainStore.set).toHaveBeenCalled();
        expect(loadSamplesForInstrument).toHaveBeenCalledWith('violin-1');
        // Forwards each engine param at least once
        expect(setLevainParamWithAudio).toHaveBeenCalledWith('masterGain', expect.any(Number));
        expect(setLevainParamWithAudio).toHaveBeenCalledWith('legato', expect.anything());
    });

    it('skips patch updates when the store is empty', () => {
        // @ts-expect-error — overriding mock value for null branch
        levainStore.value = null;

        loadInstrument('violin-1');

        expect(levainStore.set).not.toHaveBeenCalled();
        // Sample load is still triggered
        expect(loadSamplesForInstrument).toHaveBeenCalledWith('violin-1');
    });
});
