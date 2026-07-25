import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSavePreset } from '../handleSavePreset';

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn(),
    saveCurrentAsPreset: vi.fn(),
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('../../../useCases/preset/presetStorage/saveCurrentAsPreset', () => ({
    saveCurrentAsPreset: mocks.saveCurrentAsPreset,
}));

describe('handleSavePreset', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('bails if track cannot be found', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });

        void handleSavePreset.execute({
            type: 'savePreset',
            payload: { trackId: 't1', name: 'My Preset', category: 'Synth' },
        });

        expect(mocks.saveCurrentAsPreset).not.toHaveBeenCalled();
    });

    it('saves current track devices as preset', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    kind: 'midi',
                    devices: [{ type: 'EQ', name: 'EQ 1', parameterValues: { gain: 1 } }],
                },
            ],
        });

        void handleSavePreset.execute({
            type: 'savePreset',
            payload: { trackId: 't1', name: 'My Preset', category: 'Synth' },
        });

        expect(mocks.saveCurrentAsPreset).toHaveBeenCalledWith({
            name: 'My Preset',
            category: 'Synth',
            trackKind: 'midi',
            devices: [{ type: 'EQ', name: 'EQ 1', parameterValues: { gain: 1 } }],
        });
    });

    it('provides a description reflecting the track name', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', name: 'Lead' }] });
        const desc = handleSavePreset.describe({
            type: 'savePreset',
            payload: { trackId: 't1', name: 'P', category: 'Synth' },
        });
        expect(desc.label).toBe('Save preset "P" from Lead');
    });

    it('provides a generic description when the source track cannot be found', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });
        const desc = handleSavePreset.describe({
            type: 'savePreset',
            payload: { trackId: 'ghost', name: 'P', category: 'Synth' },
        });
        expect(desc.label).toBe('Save preset "P" from track');
    });

    it('classifies an audio-kind track as an audio preset', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    kind: 'audio',
                    devices: [{ type: 'Compressor', name: 'Comp', parameterValues: { threshold: -12 } }],
                },
            ],
        });

        void handleSavePreset.execute({
            type: 'savePreset',
            payload: { trackId: 't1', name: 'Drum Bus', category: 'Drums' },
        });

        expect(mocks.saveCurrentAsPreset).toHaveBeenCalledWith({
            name: 'Drum Bus',
            category: 'Drums',
            trackKind: 'audio',
            devices: [{ type: 'Compressor', name: 'Comp', parameterValues: { threshold: -12 } }],
        });
    });

    it('is not undoable', () => {
        expect(handleSavePreset.undoable).toBe(false);
    });
});
