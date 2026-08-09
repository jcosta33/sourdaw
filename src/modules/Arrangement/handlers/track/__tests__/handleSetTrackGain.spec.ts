import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSetTrackGain } from '../handleSetTrackGain';

const mocks = vi.hoisted(() => ({
    setTrackGain: vi.fn(),
    getTrackStoreState: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/setTrackGainPan/setTrackGain', () => ({
    setTrackGain: mocks.setTrackGain,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('handleSetTrackGain', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('execute', () => {
        it('calls setTrackGain', () => {
            void handleSetTrackGain.execute({
                type: 'setTrackGain',
                payload: { trackId: 't1', gain: 0.5 },
            });
            expect(mocks.setTrackGain).toHaveBeenCalledWith('t1', 0.5);
        });
    });

    describe('describe', () => {
        it('returns inverse action with previous gain', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', gain: 1.0 }] });

            const desc = handleSetTrackGain.describe({
                type: 'setTrackGain',
                payload: { trackId: 't1', gain: 0.5 },
            });

            expect(desc.label).toBe('Set track gain');
            expect(desc.inverseAction).toEqual({
                type: 'setTrackGain',
                payload: { trackId: 't1', gain: 1.0 },
            });
        });

        it('returns null inverse action if track not found', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [] });

            const desc = handleSetTrackGain.describe({
                type: 'setTrackGain',
                payload: { trackId: 't1', gain: 0.5 },
            });

            expect(desc.inverseAction).toBeNull();
        });
    });

    // `docs/manual/02-concepts.md` lists track gain among the operations that
    // record from the assistant and the command list but not from the mixer
    // strip, which reaches `setTrackGain` directly. That contrast is only true
    // while this stays `true`.
    it('is undoable', () => {
        expect(handleSetTrackGain.undoable).toBe(true);
    });
});
