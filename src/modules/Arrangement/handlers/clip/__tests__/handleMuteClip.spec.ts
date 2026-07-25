import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleMuteClip } from '../handleMuteClip';

const mocks = vi.hoisted(() => ({
    muteClip: vi.fn(),
}));

vi.mock('../../../useCases/clipEditing/muteClip', () => ({
    muteClip: mocks.muteClip,
}));

describe('handleMuteClip', () => {
    beforeEach(() => vi.clearAllMocks());

    it('delegates to muteClip use case', () => {
        void handleMuteClip.execute({
            type: 'muteClip',
            payload: { clipId: 'c1', muted: true },
        });
        expect(mocks.muteClip).toHaveBeenCalledWith('c1', true);
    });

    it('describes a muting label when muting', () => {
        const desc = handleMuteClip.describe({ type: 'muteClip', payload: { clipId: 'c1', muted: true } });
        expect(desc.label).toBe('Mute clip');
    });

    it('describes an unmuting label when unmuting', () => {
        const desc = handleMuteClip.describe({ type: 'muteClip', payload: { clipId: 'c1', muted: false } });
        expect(desc.label).toBe('Unmute clip');
    });

    it('reports the write status returned by the use case', () => {
        mocks.muteClip.mockReturnValue(true);
        expect(handleMuteClip.execute({ type: 'muteClip', payload: { clipId: 'c1', muted: true } })).toEqual({
            status: 'written',
        });
    });

    it('reports no-write when the use case makes no change', () => {
        mocks.muteClip.mockReturnValue(false);
        expect(handleMuteClip.execute({ type: 'muteClip', payload: { clipId: 'c1', muted: true } })).toEqual({
            status: 'no-write',
        });
    });

    it('is undoable', () => {
        expect(handleMuteClip.undoable).toBe(true);
    });
});
