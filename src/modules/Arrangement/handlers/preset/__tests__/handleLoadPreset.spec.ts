import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleLoadPreset } from '../handleLoadPreset';

const mocks = vi.hoisted(() => ({
    getUserPresets: vi.fn(),
    loadPresetToTrack: vi.fn(),
    createTrackFromPreset: vi.fn(),
}));

vi.mock('../../../useCases/preset/presetStorage/getUserPresets', () => ({
    getUserPresets: mocks.getUserPresets,
}));

vi.mock('../../../useCases/preset/presetLoading', () => ({
    loadPresetToTrack: mocks.loadPresetToTrack,
    createTrackFromPreset: mocks.createTrackFromPreset,
}));

describe('handleLoadPreset', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('bails if preset cannot be found', () => {
        mocks.getUserPresets.mockReturnValue([]);

        handleLoadPreset.execute({ type: 'loadPreset', payload: { presetId: 'p1' } });

        expect(mocks.loadPresetToTrack).not.toHaveBeenCalled();
        expect(mocks.createTrackFromPreset).not.toHaveBeenCalled();
    });

    it('loads preset to track if trackId is provided', () => {
        const preset = { id: 'p1', name: 'Cool Synth' };
        mocks.getUserPresets.mockReturnValue([preset]);

        handleLoadPreset.execute({ type: 'loadPreset', payload: { presetId: 'p1', trackId: 't1' } });

        expect(mocks.loadPresetToTrack).toHaveBeenCalledWith('t1', preset);
        expect(mocks.createTrackFromPreset).not.toHaveBeenCalled();
    });

    it('creates track from preset if trackId is not provided', () => {
        const preset = { id: 'p1', name: 'Cool Synth' };
        mocks.getUserPresets.mockReturnValue([preset]);

        handleLoadPreset.execute({ type: 'loadPreset', payload: { presetId: 'p1' } });

        expect(mocks.createTrackFromPreset).toHaveBeenCalledWith(preset);
        expect(mocks.loadPresetToTrack).not.toHaveBeenCalled();
    });

    it('provides a description reflecting the preset name if found', () => {
        mocks.getUserPresets.mockReturnValue([{ id: 'p1', name: 'Cool Synth' }]);

        const desc = handleLoadPreset.describe({ type: 'loadPreset', payload: { presetId: 'p1' } });
        expect(desc.label).toBe('Load preset "Cool Synth"');
    });

    it('provides a description reflecting presetId if not found', () => {
        mocks.getUserPresets.mockReturnValue([]);

        const desc = handleLoadPreset.describe({ type: 'loadPreset', payload: { presetId: 'p1' } });
        expect(desc.label).toBe('Load preset p1');
    });

    it('is undoable', () => {
        expect(handleLoadPreset.undoable).toBe(true);
    });
});
