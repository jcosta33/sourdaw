import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type SoundPreset } from '../../../models/SoundPreset';
import { createTrack as createTrackModel } from '../../../models/Track';
import { addTrack } from '../../addTrack';
import { createTrackFromPreset } from '../createTrackFromPreset';
import { loadPresetToTrack } from '../presetLoading';

vi.mock('../../addTrack', () => ({
    addTrack: vi.fn(),
}));

vi.mock('../presetLoading', () => ({
    loadPresetToTrack: vi.fn(),
}));

function basePreset(): SoundPreset {
    return {
        id: 'p1',
        name: 'Glass Pad',
        category: 'pad',
        description: '',
        trackKind: 'midi',
        devices: [{ type: 'builtin-synth', name: 'Poly', parameterValues: { cutoff: 0.6 } }],
        tags: [],
        author: 'test',
        isFactory: true,
    };
}

describe('createTrackFromPreset', () => {
    beforeEach(() => {
        vi.mocked(addTrack).mockReset();
        vi.mocked(loadPresetToTrack).mockReset();
    });

    it('should create a track from the preset name and kind, load it, and return its id', () => {
        const preset = basePreset();
        const track = createTrackModel({ id: 'track-1', name: preset.name, kind: preset.trackKind });
        vi.mocked(addTrack).mockReturnValue(track);

        const result = createTrackFromPreset(preset);

        expect(addTrack).toHaveBeenCalledWith({ name: 'Glass Pad', kind: 'midi' });
        expect(loadPresetToTrack).toHaveBeenCalledWith('track-1', preset);
        expect(result).toBe('track-1');
    });

    it('should return null and not load the preset when track creation fails', () => {
        const preset = basePreset();
        vi.mocked(addTrack).mockReturnValue(null);

        const result = createTrackFromPreset(preset);

        expect(result).toBeNull();
        expect(loadPresetToTrack).not.toHaveBeenCalled();
    });
});
