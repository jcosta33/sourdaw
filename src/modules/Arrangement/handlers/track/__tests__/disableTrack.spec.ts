import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleDisableTrack } from '../disableTrack';

const mocks = vi.hoisted(() => ({
    disableTrack: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/toggleTrackState/disableTrack', () => ({
    disableTrack: mocks.disableTrack,
}));

describe('handleDisableTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes disableTrack with the provided payload', () => {
        handleDisableTrack.execute({
            type: 'disableTrack',
            payload: { trackId: 't1', disabled: true },
        });

        expect(mocks.disableTrack).toHaveBeenCalledWith('t1', true);
    });

    it('provides a description reflecting disabled state', () => {
        const desc1 = handleDisableTrack.describe({
            type: 'disableTrack',
            payload: { trackId: 't1', disabled: true },
        });
        expect(desc1.label).toBe('Disable track');

        const desc2 = handleDisableTrack.describe({
            type: 'disableTrack',
            payload: { trackId: 't1', disabled: false },
        });
        expect(desc2.label).toBe('Enable track');
    });

    it('is undoable', () => {
        expect(handleDisableTrack.undoable).toBe(true);
    });
});
