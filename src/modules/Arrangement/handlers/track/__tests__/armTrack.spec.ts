import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleArmTrack } from '../armTrack';

const mocks = vi.hoisted(() => ({
    armTrack: vi.fn(),
    getTrackStoreState: vi.fn<() => { tracks: { id: string; armed: boolean }[] } | null>(),
}));

vi.mock('../../../useCases/recording/armTrack', () => ({
    armTrack: mocks.armTrack,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('handleArmTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue(null);
    });

    it('executes armTrack with the provided payload', () => {
        mocks.armTrack.mockReturnValue(true);
        const result = handleArmTrack.execute({
            type: 'armTrack',
            payload: { trackId: 't1', armed: true },
        });

        expect(mocks.armTrack).toHaveBeenCalledWith('t1', true);
        expect(result).toEqual({ status: 'written' });
    });

    it('reports no-write when arming is rejected', () => {
        mocks.armTrack.mockReturnValue(false);

        const result = handleArmTrack.execute({
            type: 'armTrack',
            payload: { trackId: 'vca-1', armed: true },
        });

        expect(result).toEqual({ status: 'no-write' });
    });

    it('reports permitted disarm cleanup as a write', () => {
        mocks.armTrack.mockReturnValue(true);

        const result = handleArmTrack.execute({
            type: 'armTrack',
            payload: { trackId: 'vca-1', armed: false },
        });

        expect(result).toEqual({ status: 'written' });
    });

    it('provides a description reflecting armed state', () => {
        const desc1 = handleArmTrack.describe({
            type: 'armTrack',
            payload: { trackId: 't1', armed: true },
        });
        expect(desc1.label).toBe('Arm track');

        const desc2 = handleArmTrack.describe({
            type: 'armTrack',
            payload: { trackId: 't1', armed: false },
        });
        expect(desc2.label).toBe('Disarm track');
    });

    it('describes an inverse restoring the previous armed state', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', armed: false }] });

        const desc = handleArmTrack.describe({
            type: 'armTrack',
            payload: { trackId: 't1', armed: true },
        });

        expect(desc.inverseAction).toEqual({
            type: 'armTrack',
            payload: { trackId: 't1', armed: false },
        });
    });

    it('does not negate the payload when the forward arm is a no-op', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', armed: true }] });

        const desc = handleArmTrack.describe({
            type: 'armTrack',
            payload: { trackId: 't1', armed: true },
        });

        // Arming an already-armed track changes nothing; a negating inverse
        // would wrongly disarm it. The inverse restores the captured pre-state.
        expect(desc.inverseAction).toEqual({
            type: 'armTrack',
            payload: { trackId: 't1', armed: true },
        });
    });

    it('is undoable', () => {
        expect(handleArmTrack.undoable).toBe(true);
    });
});
