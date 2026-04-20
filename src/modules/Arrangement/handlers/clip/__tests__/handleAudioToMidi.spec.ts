import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleAudioToMidi } from '../handleAudioToMidi';

const mocks = vi.hoisted(() => ({
    audioToMidi: vi.fn(),
}));

vi.mock('#/modules/AudioAnalysis/useCases', () => ({
    audioToMidi: mocks.audioToMidi,
}));

describe('handleAudioToMidi', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes audioToMidi with the provided payload', () => {
        handleAudioToMidi.execute({
            type: 'audioToMidi',
            payload: {
                clipId: 'c1',
                trackId: 't1',
                sensitivity: 0.8,
                mode: 'pitched',
            },
        });

        expect(mocks.audioToMidi).toHaveBeenCalledWith({
            clipId: 'c1',
            trackId: 't1',
            sensitivity: 0.8,
            mode: 'pitched',
        });
    });

    it('uses defaults for missing parameters', () => {
        handleAudioToMidi.execute({
            type: 'audioToMidi',
            payload: {
                clipId: 'c1',
            },
        });

        expect(mocks.audioToMidi).toHaveBeenCalledWith({
            clipId: 'c1',
            trackId: '',
            sensitivity: undefined,
            mode: 'rhythm',
        });
    });

    it('provides a description', () => {
        const desc = handleAudioToMidi.describe({
            type: 'audioToMidi',
            payload: { clipId: 'c1' },
        });
        expect(desc.label).toBe('Convert audio to MIDI');
    });

    it('is undoable', () => {
        expect(handleAudioToMidi.undoable).toBe(true);
    });
});
