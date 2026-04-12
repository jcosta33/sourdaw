import { describe, it, expect, vi } from 'vitest';
import { summarizeFeatures } from '#/modules/AudioAnalysis/useCases';
import { addMidiNote } from '#/modules/MIDI/useCases';
import { addTrack } from '../addTrack';
import { addClip } from '../clip/addClip';
import { audioToMidi } from '../audioAnalysis/audioToMidi';
import { detectKey } from '../audioAnalysis/detectKey';
import * as helpers from '../audioAnalysis/helpers';

vi.mock('#/modules/AudioAnalysis/useCases', () => ({
    summarizeFeatures: vi.fn(),
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    addMidiNote: vi.fn(),
}));

vi.mock('../addTrack', () => ({
    addTrack: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/clip/addClip', () => ({
    addClip: vi.fn(),
}));

vi.mock('../audioAnalysis/helpers', () => ({
    getBufferForClip: vi.fn(),
}));

describe('detectKey', () => {
    it('does not call summarizeFeatures when the clip has no audio buffer', async () => {
        vi.mocked(helpers.getBufferForClip).mockReturnValue(null);

        await detectKey('clip-that-does-not-exist');

        expect(summarizeFeatures).not.toHaveBeenCalled();
    });
});

describe('audioToMidi', () => {
    it('does not create tracks when the clip has no audio buffer', async () => {
        vi.mocked(helpers.getBufferForClip).mockReturnValue(null);

        await audioToMidi('clip-that-does-not-exist');

        expect(addTrack).not.toHaveBeenCalled();
        expect(addClip).not.toHaveBeenCalled();
        expect(addMidiNote).not.toHaveBeenCalled();
    });
});
