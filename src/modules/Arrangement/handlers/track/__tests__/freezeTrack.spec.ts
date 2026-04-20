import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleFreezeTrack } from '../freezeTrack';

const mocks = vi.hoisted(() => ({
    freezeTrack: vi.fn(),
}));

vi.mock('../../../useCases/freezeBounce/freezeTrack', () => ({
    freezeTrack: mocks.freezeTrack,
}));

describe('handleFreezeTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes freezeTrack with the provided payload', async () => {
        await handleFreezeTrack.execute({
            type: 'freezeTrack',
            payload: { trackId: 't1' },
        });

        expect(mocks.freezeTrack).toHaveBeenCalledWith('t1');
    });

    it('provides a description', () => {
        const desc = handleFreezeTrack.describe({
            type: 'freezeTrack',
            payload: { trackId: 't1' },
        });
        expect(desc.label).toBe('Freeze track');
    });

    it('is undoable', () => {
        expect(handleFreezeTrack.undoable).toBe(true);
    });
});
