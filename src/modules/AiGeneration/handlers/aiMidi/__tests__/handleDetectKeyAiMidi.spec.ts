import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleDetectKeyAiMidi } from '../handleDetectKeyAiMidi';

const mocks = vi.hoisted(() => ({
    detectKey: vi.fn(),
    info: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    detectKey: mocks.detectKey,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { info: mocks.info },
}));

describe('handleDetectKeyAiMidi', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes detectKey and logs the result', async () => {
        mocks.detectKey.mockResolvedValue('C Major');

        await handleDetectKeyAiMidi.execute({
            type: 'detectKey',
            payload: { clipId: 'c1' },
        });

        expect(mocks.detectKey).toHaveBeenCalledWith('c1');
        expect(mocks.info).toHaveBeenCalledWith('[Analysis] Key detected for clip c1: C Major');
    });

    it('provides a description', () => {
        const desc = handleDetectKeyAiMidi.describe({
            type: 'detectKey',
            payload: { clipId: 'c1' },
        });
        expect(desc.label).toBe('Detect key');
    });

    it('is not undoable', () => {
        expect(handleDetectKeyAiMidi.undoable).toBe(false);
    });
});
