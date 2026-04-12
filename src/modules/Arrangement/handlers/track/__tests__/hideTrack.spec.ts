import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleHideTrack } from '../hideTrack';

const mocks = vi.hoisted(() => ({
    hideTrack: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/toggleTrackState/hideTrack', () => ({
    hideTrack: mocks.hideTrack,
}));

describe('handleHideTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes hideTrack with payload', () => {
        handleHideTrack.execute({
            type: 'hideTrack',
            payload: { trackId: 't1', hidden: true },
        });

        expect(mocks.hideTrack).toHaveBeenCalledWith('t1', true);
    });

    it('provides a description based on hidden state', () => {
        const desc1 = handleHideTrack.describe({
            type: 'hideTrack',
            payload: { trackId: 't1', hidden: true },
        });
        expect(desc1.label).toBe('Hide track');

        const desc2 = handleHideTrack.describe({
            type: 'hideTrack',
            payload: { trackId: 't1', hidden: false },
        });
        expect(desc2.label).toBe('Show track');
    });

    it('is undoable', () => {
        expect(handleHideTrack.undoable).toBe(true);
    });
});
