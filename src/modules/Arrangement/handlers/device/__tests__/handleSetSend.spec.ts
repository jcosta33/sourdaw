import { describe, it, expect, vi, beforeEach } from 'vitest';

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

    it('is undoable', () => {
        expect(handleSetSend.undoable).toBe(true);
    });
});
