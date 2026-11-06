import { describe, it, expect, vi, beforeEach } from 'vitest';

import { dbToGain } from '#/utils/audioLevelLaw';

import { handleSetSend } from '../handleSetSend';

const mocks = vi.hoisted(() => ({
    setSend: vi.fn(),
    getTrackStoreState: vi.fn<
        () => {
            tracks: { id: string; kind: string; sends: { busId: string; level: number; preFader: boolean }[] }[];
        } | null
    >(),
}));

vi.mock('../../../useCases/device/sendManagement/setSend', () => ({
    setSend: mocks.setSend,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('handleSetSend', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue(null);
    });

    it('executes setSend with the provided payload', () => {
        const finalizeRuntimeEffect = vi.fn();
        const reconcileRuntimeEffect = vi.fn();
        mocks.setSend.mockReturnValue({
            afterCommit: finalizeRuntimeEffect,
            afterAmbiguousCommit: reconcileRuntimeEffect,
        });
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', kind: 'audio', sends: [{ busId: 'bus-1', level: 0.2, preFader: true }] }],
        });
        const result = handleSetSend.execute({
            type: 'setSend',
            payload: { trackId: 't1', busId: 'bus-1', level: 0.5 },
        });

        expect(mocks.setSend).toHaveBeenCalledWith('t1', 'bus-1', 0.5, true, { deferRuntimeEffect: true });
        expect(finalizeRuntimeEffect).not.toHaveBeenCalled();
        if (!result || result instanceof Promise) {
            throw new Error('expected a synchronous handler result');
        }
        result.afterCommit?.();
        expect(finalizeRuntimeEffect).toHaveBeenCalledOnce();
        result.afterAmbiguousCommit?.();
        expect(reconcileRuntimeEffect).toHaveBeenCalledOnce();
    });

    it('returns conflict when the send update is rejected', () => {
        mocks.setSend.mockReturnValue(null);
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', kind: 'audio', sends: [{ busId: 'vca-1', level: 0.2, preFader: false }] }],
        });
        const result = handleSetSend.execute({
            type: 'setSend',
            payload: { trackId: 't1', busId: 'vca-1', level: 0.5 },
        });

        expect(result).toEqual({ status: 'conflict' });
    });

    it('provides a description', () => {
        const desc = handleSetSend.describe({
            type: 'setSend',
            payload: { trackId: 't1', busId: 'bus-1', level: 0.5 },
        });
        expect(desc.label).toBe('Set send level');
        expect(desc.inverseAction).toBeNull();
    });

    it('describes a level-restore inverse when the send exists', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                { id: 't1', kind: 'audio', sends: [{ busId: 'bus-1', level: 0.2, preFader: true }] },
                { id: 'bus-1', kind: 'bus', sends: [] },
            ],
        });

        const desc = handleSetSend.describe({
            type: 'setSend',
            payload: { trackId: 't1', busId: 'bus-1', level: 0.9 },
        });

        expect(desc.inverseAction).toEqual({
            type: 'setSend',
            payload: {
                trackId: 't1',
                busId: 'bus-1',
                level: 0.2,
                preFader: true,
                expectedLevel: 0.9,
                expectedPreFader: true,
            },
        });
    });

    it('does not make a stale missing send compensable', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                { id: 't1', kind: 'audio', sends: [] },
                { id: 'bus-1', kind: 'bus', sends: [] },
            ],
        });

        const desc = handleSetSend.describe({
            type: 'setSend',
            payload: { trackId: 't1', busId: 'bus-1', level: 0.5 },
        });

        expect(desc.inverseAction).toBeNull();
    });

    it('detects an unchanged send level as a semantic no-op', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', kind: 'audio', sends: [{ busId: 'bus-1', level: 0.5, preFader: false }] }],
        });

        const isNoop = handleSetSend.isNoop?.({
            type: 'setSend',
            payload: { trackId: 't1', busId: 'bus-1', level: 0.5 },
        });

        expect(isNoop).toBe(true);
    });

    it('detects an unchanged send level stated in decibels as a semantic no-op', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', kind: 'audio', sends: [{ busId: 'bus-1', level: dbToGain(-6), preFader: false }] }],
        });

        const isNoop = handleSetSend.isNoop?.({
            type: 'setSend',
            payload: { trackId: 't1', busId: 'bus-1', levelDb: -6 },
        });

        expect(isNoop).toBe(true);
    });

    it('does not treat a relative decibel request against the same send as a no-op', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', kind: 'audio', sends: [{ busId: 'bus-1', level: dbToGain(-6), preFader: false }] }],
        });

        const isNoop = handleSetSend.isNoop?.({
            type: 'setSend',
            payload: { trackId: 't1', busId: 'bus-1', deltaDb: -3 },
        });

        expect(isNoop).toBe(false);
    });

    it('does not treat a differing decibel level as a no-op', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', kind: 'audio', sends: [{ busId: 'bus-1', level: dbToGain(-6), preFader: false }] }],
        });

        const isNoop = handleSetSend.isNoop?.({
            type: 'setSend',
            payload: { trackId: 't1', busId: 'bus-1', levelDb: -3 },
        });

        expect(isNoop).toBe(false);
    });

    it('executes a conditional level restore when the expected send still matches', () => {
        const finalizeRuntimeEffect = vi.fn();
        mocks.setSend.mockReturnValue({
            afterCommit: finalizeRuntimeEffect,
            afterAmbiguousCommit: vi.fn(),
        });
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', kind: 'audio', sends: [{ busId: 'bus-1', level: 0.2, preFader: false }] }],
        });

        const result = handleSetSend.execute({
            type: 'setSend',
            payload: {
                trackId: 't1',
                busId: 'bus-1',
                level: 0.5,
                expectedLevel: 0.2,
                expectedPreFader: false,
            },
        });

        expect(mocks.setSend).toHaveBeenCalledWith('t1', 'bus-1', 0.5, false, { deferRuntimeEffect: true });
        if (!result || result instanceof Promise) {
            throw new Error('expected a synchronous handler result');
        }
        result.afterCommit?.();
        expect(finalizeRuntimeEffect).toHaveBeenCalledOnce();
    });

    it('rejects a stale set when the send no longer exists', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', kind: 'audio', sends: [] }],
        });

        const result = handleSetSend.execute({
            type: 'setSend',
            payload: { trackId: 't1', busId: 'bus-1', level: 0.5 },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.setSend).not.toHaveBeenCalled();
    });

    it('rejects a conditional restore after the send changed again', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', kind: 'audio', sends: [{ busId: 'bus-1', level: 0.7, preFader: false }] }],
        });

        const result = handleSetSend.execute({
            type: 'setSend',
            payload: {
                trackId: 't1',
                busId: 'bus-1',
                level: 0.2,
                expectedLevel: 0.5,
                expectedPreFader: false,
            },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.setSend).not.toHaveBeenCalled();
    });

    it('does not make a stale missing bus target compensable', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', kind: 'audio', sends: [] }],
        });

        const desc = handleSetSend.describe({
            type: 'setSend',
            payload: { trackId: 't1', busId: 'missing-bus', level: 0.5 },
        });

        expect(desc.inverseAction).toBeNull();
    });

    it('certifies divergence reapplication only for a payload guarding level and pre-fader state', () => {
        expect(
            handleSetSend.canReapplyAfterDivergence?.({
                type: 'setSend',
                payload: { trackId: 't1', busId: 'bus-1', level: 0.2, expectedLevel: 0.5, expectedPreFader: false },
            })
        ).toBe(true);
        expect(
            handleSetSend.canReapplyAfterDivergence?.({
                type: 'setSend',
                payload: { trackId: 't1', busId: 'bus-1', level: 0.2, expectedLevel: 0.5 },
            })
        ).toBe(false);
        expect(
            handleSetSend.canReapplyAfterDivergence?.({
                type: 'setSend',
                payload: { trackId: 't1', busId: 'bus-1', level: 0.2, expectedPreFader: false },
            })
        ).toBe(false);
        expect(
            handleSetSend.canReapplyAfterDivergence?.({
                type: 'setSend',
                payload: { trackId: 't1', busId: 'bus-1', level: 0.2 },
            })
        ).toBe(false);
    });

    describe('pre-fader tap point', () => {
        const sendState = (preFader: boolean) => ({
            tracks: [
                { id: 't1', kind: 'audio', sends: [{ busId: 'bus-1', level: 0.5, preFader }] },
                { id: 'bus-1', kind: 'bus', sends: [] },
            ],
        });

        it('writes a payload that changes only the tap point and is not a no-op', () => {
            mocks.getTrackStoreState.mockReturnValue(sendState(false));
            mocks.setSend.mockReturnValue({ afterCommit: vi.fn(), afterAmbiguousCommit: vi.fn() });
            const action = {
                type: 'setSend' as const,
                payload: { trackId: 't1', busId: 'bus-1', level: 0.5, preFader: true },
            };

            expect(handleSetSend.isNoop?.(action)).toBe(false);
            handleSetSend.execute(action);

            expect(mocks.setSend).toHaveBeenCalledWith('t1', 'bus-1', 0.5, true, { deferRuntimeEffect: true });
        });

        it('treats a payload restating the current tap point and level as a no-op', () => {
            mocks.getTrackStoreState.mockReturnValue(sendState(true));

            expect(
                handleSetSend.isNoop?.({
                    type: 'setSend',
                    payload: { trackId: 't1', busId: 'bus-1', level: 0.5, preFader: true },
                })
            ).toBe(true);
        });

        it('describes an inverse that restores the previous tap point and a redo that re-applies the new one', () => {
            mocks.getTrackStoreState.mockReturnValue(sendState(false));

            const desc = handleSetSend.describe({
                type: 'setSend',
                payload: {
                    trackId: 't1',
                    busId: 'bus-1',
                    level: 0.5,
                    preFader: true,
                    expectedLevel: 0.5,
                    expectedPreFader: false,
                },
            });

            expect(desc.label).toBe('Set send pre-fader');
            expect(desc.inverseAction).toEqual({
                type: 'setSend',
                payload: {
                    trackId: 't1',
                    busId: 'bus-1',
                    level: 0.5,
                    preFader: false,
                    expectedLevel: 0.5,
                    expectedPreFader: true,
                },
            });
            expect(desc.redoAction).toEqual({
                type: 'setSend',
                payload: {
                    trackId: 't1',
                    busId: 'bus-1',
                    level: 0.5,
                    preFader: true,
                    expectedLevel: 0.5,
                    expectedPreFader: false,
                },
            });
        });

        it('conflicts when the stored tap point differs from expectedPreFader', () => {
            mocks.getTrackStoreState.mockReturnValue(sendState(true));

            const result = handleSetSend.execute({
                type: 'setSend',
                payload: { trackId: 't1', busId: 'bus-1', level: 0.5, preFader: false, expectedPreFader: false },
            });

            expect(result).toEqual({ status: 'conflict' });
            expect(mocks.setSend).not.toHaveBeenCalled();
        });
    });

    it('is undoable', () => {
        expect(handleSetSend.undoable).toBe(true);
    });
});
