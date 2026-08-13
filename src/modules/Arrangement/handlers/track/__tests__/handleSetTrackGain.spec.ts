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
    it('validates the expected gain without writing runtime or project state', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 'track-1', gain: 0.5 }] });

        expect(
            handleSetTrackGain.validate?.(
                {
                    type: 'setTrackGain',
                    payload: { trackId: 'track-1', gain: 0.8, expectedGain: 0.5 },
                },
                { actions: [], actionIndex: 0 }
            )
        ).toBe(true);
        expect(
            handleSetTrackGain.validate?.(
                {
                    type: 'setTrackGain',
                    payload: { trackId: 'track-1', gain: 0.8, expectedGain: 0.4 },
                },
                { actions: [], actionIndex: 0 }
            )
        ).toBe(false);
        expect(mocks.setTrackGain).not.toHaveBeenCalled();
    });
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('execute', () => {
        it('calls setTrackGain', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', gain: 1 }] });
            void handleSetTrackGain.execute({
                type: 'setTrackGain',
                payload: { trackId: 't1', gain: 0.5, expectedGain: 1 },
            });
            expect(mocks.setTrackGain).toHaveBeenCalledWith('t1', 0.5);
        });

        it('rejects a gain write when current project truth diverged', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', gain: 0.75 }] });

            const result = handleSetTrackGain.execute({
                type: 'setTrackGain',
                payload: { trackId: 't1', gain: 0.5, expectedGain: 1 },
            });

            expect(result).toEqual({ status: 'conflict' });
            expect(mocks.setTrackGain).not.toHaveBeenCalled();
        });
    });

    describe('describe', () => {
        it('returns inverse action with previous gain', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', gain: 1.0 }] });

            const desc = handleSetTrackGain.describe({
                type: 'setTrackGain',
                payload: { trackId: 't1', gain: 0.5, expectedGain: 1 },
            });

            expect(desc.label).toBe('Set track gain');
            expect(desc.inverseAction).toEqual({
                type: 'setTrackGain',
                payload: { trackId: 't1', gain: 1.0, expectedGain: 0.5 },
            });
            expect(desc.redoAction).toEqual({
                type: 'setTrackGain',
                payload: { trackId: 't1', gain: 0.5, expectedGain: 1.0 },
            });
        });

        it('uses the app-owned expected gain when the track is created earlier in the batch', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [] });

            const desc = handleSetTrackGain.describe({
                type: 'setTrackGain',
                payload: { trackId: 't1', gain: 0.5, expectedGain: 1 },
            });

            expect(desc.inverseAction).toEqual({
                type: 'setTrackGain',
                payload: { trackId: 't1', gain: 1, expectedGain: 0.5 },
            });
            expect(desc.redoAction).toEqual({
                type: 'setTrackGain',
                payload: { trackId: 't1', gain: 0.5, expectedGain: 1 },
            });
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
