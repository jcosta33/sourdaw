import { describe, it, expect, vi } from 'vitest';

import { addMidiNote } from '#/modules/MIDI/useCases';

import { addTrack } from '../addTrack';
import { audioToMidi } from '../audioAnalysis/audioToMidi';
import * as helpers from '../audioAnalysis/helpers';
import { addClip } from '../clip/addClip';

vi.mock('#/modules/AudioAnalysis/useCases', () => ({
    summarizeFeatures: vi.fn(),
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    addMidiNote: vi.fn(),
}));

vi.mock('../addTrack', () => ({
    addTrack: vi.fn(),
}));

vi.mock('../clip/addClip', () => ({
    addClip: vi.fn(),
}));

vi.mock('../audioAnalysis/helpers', () => ({
    getBufferForClip: vi.fn(),
}));

describe('audioToMidi', () => {
    it('does not create tracks when the clip has no audio buffer', async () => {
        vi.mocked(helpers.getBufferForClip).mockReturnValue(null);

        await audioToMidi('clip-that-does-not-exist');

        expect(addTrack).not.toHaveBeenCalled();
        expect(addClip).not.toHaveBeenCalled();
        expect(addMidiNote).not.toHaveBeenCalled();
    });
});
