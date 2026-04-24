import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleStripSilenceAiMidi } from '../handleStripSilenceAiMidi';

const mocks = vi.hoisted(() => ({
    stripSilence: vi.fn(),
    info: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    stripSilence: mocks.stripSilence,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { info: mocks.info },
}));

describe('handleStripSilenceAiMidi', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes strip silence with threshold and logs it', () => {
        void handleStripSilenceAiMidi.execute({
            type: 'stripSilence',
            payload: { clipId: 'c1', threshold: -30 },
        });

        expect(mocks.stripSilence).toHaveBeenCalledWith('c1', -30);
        expect(mocks.info).toHaveBeenCalledWith('[Analysis] Strip silence executed for clip c1');
    });

    it('falls back to -40 if threshold is omitted', () => {
        void handleStripSilenceAiMidi.execute({
            type: 'stripSilence',
            payload: { clipId: 'c2' },
        });

        expect(mocks.stripSilence).toHaveBeenCalledWith('c2', -40);
    });

    it('provides a description', () => {
        const desc = handleStripSilenceAiMidi.describe({
            type: 'stripSilence',
            payload: { clipId: 'c1' },
        });
        expect(desc.label).toBe('Strip silence');
    });

    it('is undoable', () => {
        expect(handleStripSilenceAiMidi.undoable).toBe(true);
    });
});
