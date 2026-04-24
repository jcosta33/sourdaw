import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleAudioToMidi } from '../handleAudioToMidi';

const mocks = vi.hoisted(() => ({
    audioToMidi: vi.fn(),
}));

vi.mock('../../../useCases/audioToMidi', () => ({
    audioToMidi: mocks.audioToMidi,
}));

describe('handleAudioToMidi', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should execute audioToMidi with the provided payload', () => {
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

    it('should use defaults for missing parameters', () => {
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

    it('should provide a description', () => {
        const description = handleAudioToMidi.describe({
            type: 'audioToMidi',
            payload: { clipId: 'c1' },
        });

        expect(description.label).toBe('Convert audio to MIDI');
    });

    it('should be undoable', () => {
        expect(handleAudioToMidi.undoable).toBe(true);
    });
});
