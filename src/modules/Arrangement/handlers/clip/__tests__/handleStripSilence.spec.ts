import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleStripSilence } from '../handleStripSilence';

const mocks = vi.hoisted(() => ({
    stripSilence: vi.fn(),
}));

vi.mock('../../../useCases/stripSilence', () => ({
    stripSilence: mocks.stripSilence,
}));

describe('handleStripSilence', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes stripSilence with the provided payload', () => {
        handleStripSilence.execute({
            type: 'stripSilence',
            payload: { clipId: 'c1', threshold: -30, minDuration: 0.1 },
        });

        expect(mocks.stripSilence).toHaveBeenCalledWith('c1', -30, 0.1);
    });

    it('provides a description', () => {
        const desc = handleStripSilence.describe({
            type: 'stripSilence',
            payload: { clipId: 'c1' },
        });
        expect(desc.label).toBe('Strip silence');
    });

    it('is undoable', () => {
        expect(handleStripSilence.undoable).toBe(true);
    });
});
