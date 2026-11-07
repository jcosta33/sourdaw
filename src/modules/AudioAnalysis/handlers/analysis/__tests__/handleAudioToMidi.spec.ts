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
        mocks.audioToMidi.mockResolvedValue(true);
    });

    it('should execute audioToMidi with the provided payload', async () => {
        await handleAudioToMidi.execute({
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

    it('should use defaults for missing parameters', async () => {
        await handleAudioToMidi.execute({
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

    it('waits for conversion and reports a real no-write', async () => {
        mocks.audioToMidi.mockResolvedValueOnce(false);
        await expect(handleAudioToMidi.execute({ type: 'audioToMidi', payload: { clipId: 'c1' } })).resolves.toEqual({
            status: 'no-write',
        });
    });

    it('should provide a description', async () => {
        const description = handleAudioToMidi.describe({
            type: 'audioToMidi',
            payload: { clipId: 'c1' },
        });

        expect(description.label).toBe('Convert audio to MIDI');
    });

    it('delegates Undo to the grouped child commands and executes outside a project transaction', async () => {
        expect(handleAudioToMidi.undoable).toBe(false);
        expect(handleAudioToMidi.executionKind).toBe('runtime');
    });
});
