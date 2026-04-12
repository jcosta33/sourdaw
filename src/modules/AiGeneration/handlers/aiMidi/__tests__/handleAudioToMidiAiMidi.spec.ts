import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleAudioToMidiAiMidi } from '../handleAudioToMidiAiMidi';

const mocks = vi.hoisted(() => ({
    audioToMidi: vi.fn(),
    info: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    audioToMidi: mocks.audioToMidi,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { info: mocks.info },
}));

describe('handleAudioToMidiAiMidi', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes audioToMidi conversion and logs', async () => {
        await handleAudioToMidiAiMidi.execute({
            type: 'audioToMidi',
            payload: { clipId: 'c1' },
        });

        expect(mocks.audioToMidi).toHaveBeenCalledWith('c1');
        expect(mocks.info).toHaveBeenCalledWith('[Analysis] Audio-to-MIDI mapped for clip c1');
    });

    it('provides a description', () => {
        const desc = handleAudioToMidiAiMidi.describe({
            type: 'audioToMidi',
            payload: { clipId: 'c1' },
        });
        expect(desc.label).toBe('Convert audio to MIDI');
    });

    it('is marked as undoable', () => {
        expect(handleAudioToMidiAiMidi.undoable).toBe(true);
    });
});
