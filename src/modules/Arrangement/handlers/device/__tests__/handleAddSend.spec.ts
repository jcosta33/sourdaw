import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleAddSend } from '../handleAddSend';

const mocks = vi.hoisted(() => ({
    setSend: vi.fn(),
    getTrackStoreState:
        vi.fn<() => { tracks: { id: string; kind: string; sends: { busId: string; level: number }[] }[] } | null>(),
}));

vi.mock('../../../useCases/device/sendManagement/setSend', () => ({
    setSend: mocks.setSend,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('handleAddSend', () => {
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
        const result = handleAddSend.execute({
            type: 'addSend',
            payload: { trackId: 't1', busId: 'bus-1', level: 0.5 },
        });

        expect(mocks.setSend).toHaveBeenCalledWith('t1', 'bus-1', 0.5, false, { deferRuntimeEffect: true });
        expect(finalizeRuntimeEffect).not.toHaveBeenCalled();
        if (!result || result instanceof Promise) {
            throw new Error('expected a synchronous handler result');
        }
        result.afterCommit?.();
        expect(finalizeRuntimeEffect).toHaveBeenCalledOnce();
        result.afterAmbiguousCommit?.();
        expect(reconcileRuntimeEffect).toHaveBeenCalledOnce();
    });

    it('returns conflict when the send is rejected', () => {
        mocks.setSend.mockReturnValue(null);
        const result = handleAddSend.execute({
            type: 'addSend',
            payload: { trackId: 't1', busId: 'vca-1', level: 0.5 },
        });

        expect(result).toEqual({ status: 'conflict' });
    });

    it('provides a description', () => {
        const desc = handleAddSend.describe({
            type: 'addSend',
            payload: { trackId: 't1', busId: 'bus-1', level: 0.5 },
        });
        expect(desc.label).toBe('Add send');
        expect(desc.inverseAction).toBeNull();
    });

    it('describes a removeSend inverse when the send is genuinely new', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', kind: 'audio', sends: [] }] });

        const desc = handleAddSend.describe({
            type: 'addSend',
            payload: { trackId: 't1', busId: 'bus-1', level: 0.5 },
        });

        expect(desc.inverseAction).toEqual({
            type: 'removeSend',
            payload: {
                trackId: 't1',
                busId: 'bus-1',
                expectedLevel: 0.5,
                expectedPreFader: false,
            },
        });
    });

    it('describes the guarded inverse for an app-owned source created earlier in the batch', () => {
        const desc = handleAddSend.describe({
            type: 'addSend',
            payload: {
                trackId: 'new-source-bus',
                busId: 'new-target-bus',
                level: 0.25,
                preFader: false,
                expectedAbsent: true,
            },
        });

        expect(desc.inverseAction).toEqual({
            type: 'removeSend',
            payload: {
                trackId: 'new-source-bus',
                busId: 'new-target-bus',
                expectedLevel: 0.25,
                expectedPreFader: false,
            },
        });
    });

    it('does not make a stale existing send compensable', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', kind: 'audio', sends: [{ busId: 'bus-1', level: 0.2 }] }],
        });

        const desc = handleAddSend.describe({
            type: 'addSend',
            payload: { trackId: 't1', busId: 'bus-1', level: 0.9 },
        });

        expect(desc.inverseAction).toBeNull();
    });

    it('rejects a stale add when the send already exists', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', kind: 'audio', sends: [{ busId: 'bus-1', level: 0.2 }] }],
        });

        const result = handleAddSend.execute({
            type: 'addSend',
            payload: { trackId: 't1', busId: 'bus-1', level: 0.9 },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.setSend).not.toHaveBeenCalled();
    });

    it('is undoable', () => {
        expect(handleAddSend.undoable).toBe(true);
    });
});
