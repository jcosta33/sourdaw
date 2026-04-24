import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleDetectTempoAiMidi } from '../handleDetectTempoAiMidi';

const mocks = vi.hoisted(() => ({
    detectTempo: vi.fn(),
    info: vi.fn(),
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        value: {
            tracks: [{ id: 't1', clips: [{ id: 'c1', type: 'audio', audioBufferId: 'buf1' }] }],
        },
    },
}));

vi.mock('#/modules/AudioAnalysis/useCases', () => ({
    detectTempo: mocks.detectTempo,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { info: mocks.info },
}));

describe('handleDetectTempoAiMidi', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('detects tempo and logs it', async () => {
        mocks.detectTempo.mockReturnValue(125);

        await handleDetectTempoAiMidi.execute({
            type: 'detectTempo',
            payload: { clipId: 'c1' },
        });

        expect(mocks.detectTempo).toHaveBeenCalledWith('buf1');
        expect(mocks.info).toHaveBeenCalledWith('[Analysis] Tempo detected for clip c1: ~125 BPM');
    });

    it('provides a description', () => {
        const desc = handleDetectTempoAiMidi.describe({
            type: 'detectTempo',
            payload: { clipId: 'c1' },
        });
        expect(desc.label).toBe('Detect tempo');
    });

    it('is not undoable', () => {
        expect(handleDetectTempoAiMidi.undoable).toBe(false);
    });
});
