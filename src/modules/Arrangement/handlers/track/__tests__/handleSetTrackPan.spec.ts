import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSetTrackPan } from '../handleSetTrackPan';

const mocks = vi.hoisted(() => ({
    setTrackPan: vi.fn(),
    getTrackStoreState: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/setTrackGainPan/setTrackPan', () => ({
    setTrackPan: mocks.setTrackPan,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('handleSetTrackPan', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('validates the expected pan without writing runtime or project state', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', pan: 0 }] });

        expect(
            handleSetTrackPan.validate?.(
                {
                    type: 'setTrackPan',
                    payload: { trackId: 't1', pan: -20, expectedPan: 0 },
                },
                { actions: [], actionIndex: 0 }
            )
        ).toBe(true);
        expect(
            handleSetTrackPan.validate?.(
                {
                    type: 'setTrackPan',
                    payload: { trackId: 't1', pan: -20, expectedPan: 12 },
                },
                { actions: [], actionIndex: 0 }
            )
        ).toBe(false);
        expect(mocks.setTrackPan).not.toHaveBeenCalled();
    });

    describe('execute', () => {
        it('calls setTrackPan', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', pan: 0 }] });
            void handleSetTrackPan.execute({
                type: 'setTrackPan',
                payload: { trackId: 't1', pan: -0.5, expectedPan: 0 },
            });
            expect(mocks.setTrackPan).toHaveBeenCalledWith('t1', -0.5);
        });

        it('rejects a pan write when current project truth diverged', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', pan: 12 }] });

            const result = handleSetTrackPan.execute({
                type: 'setTrackPan',
                payload: { trackId: 't1', pan: -20, expectedPan: 0 },
            });

            expect(result).toEqual({ status: 'conflict' });
            expect(mocks.setTrackPan).not.toHaveBeenCalled();
        });
    });

    describe('describe', () => {
        it('returns inverse action with previous pan', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', pan: 0.5 }] });

            const desc = handleSetTrackPan.describe({
                type: 'setTrackPan',
                payload: { trackId: 't1', pan: -0.5, expectedPan: 0.5 },
            });

            expect(desc.label).toBe('Set track pan');
            expect(desc.inverseAction).toEqual({
                type: 'setTrackPan',
                payload: { trackId: 't1', pan: 0.5, expectedPan: -0.5 },
            });
            expect(desc.redoAction).toEqual({
                type: 'setTrackPan',
                payload: { trackId: 't1', pan: -0.5, expectedPan: 0.5 },
            });
        });

        it('returns null inverse action if track not found', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [] });

            const desc = handleSetTrackPan.describe({
                type: 'setTrackPan',
                payload: { trackId: 't1', pan: -0.5, expectedPan: 0 },
            });

            expect(desc.inverseAction).toBeNull();
        });
    });

    it('is undoable', () => {
        expect(handleSetTrackPan.undoable).toBe(true);
    });
});
