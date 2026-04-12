import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleMuteClip } from '../handleMuteClip';

const mocks = vi.hoisted(() => ({
    muteClip: vi.fn(),
}));

vi.mock('../../../useCases/clipEditing/muteClip', () => ({
    muteClip: mocks.muteClip,
}));

describe('handleMuteClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes muteClip with the provided payload', () => {
        handleMuteClip.execute({
            type: 'muteClip',
            payload: { clipId: 'c1', muted: true },
        });

        expect(mocks.muteClip).toHaveBeenCalledWith('c1', true);
    });

    it('provides a description reflecting mute status', () => {
        const desc1 = handleMuteClip.describe({
            type: 'muteClip',
            payload: { clipId: 'c1', muted: true },
        });
        expect(desc1.label).toBe('Mute clip');

        const desc2 = handleMuteClip.describe({
            type: 'muteClip',
            payload: { clipId: 'c1', muted: false },
        });
        expect(desc2.label).toBe('Unmute clip');
    });

    it('is undoable', () => {
        expect(handleMuteClip.undoable).toBe(true);
    });
});
