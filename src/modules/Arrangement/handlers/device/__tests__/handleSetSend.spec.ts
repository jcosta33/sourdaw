import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSetSend } from '../handleSetSend';

const mocks = vi.hoisted(() => ({
    setSend: vi.fn(),
    getTrackStoreState: vi.fn<
        () => {
            tracks: { id: string; kind: string; sends: { busId: string; level: number }[] }[];
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
        mocks.setSend.mockReturnValue(true);
        const result = handleSetSend.execute({
            type: 'setSend',
            payload: { trackId: 't1', busId: 'bus-1', level: 0.5 },
        });

        expect(mocks.setSend).toHaveBeenCalledWith('t1', 'bus-1', 0.5);
        expect(result).toEqual({ status: 'written' });
    });

    it('returns no-write when the send update is rejected', () => {
        mocks.setSend.mockReturnValue(false);
        const result = handleSetSend.execute({
            type: 'setSend',
            payload: { trackId: 't1', busId: 'vca-1', level: 0.5 },
        });

        expect(result).toEqual({ status: 'no-write' });
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
                { id: 't1', kind: 'audio', sends: [{ busId: 'bus-1', level: 0.2 }] },
                { id: 'bus-1', kind: 'bus', sends: [] },
            ],
        });

        const desc = handleSetSend.describe({
            type: 'setSend',
            payload: { trackId: 't1', busId: 'bus-1', level: 0.9 },
        });

        expect(desc.inverseAction).toEqual({
            type: 'setSend',
            payload: { trackId: 't1', busId: 'bus-1', level: 0.2 },
        });
    });

    it('describes a removeSend inverse when the call creates the send', () => {
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

        expect(desc.inverseAction).toEqual({
            type: 'removeSend',
            payload: { trackId: 't1', busId: 'bus-1' },
        });
    });

    it('detects an unchanged send level as a semantic no-op', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', kind: 'audio', sends: [{ busId: 'bus-1', level: 0.5 }] }],
        });

        const isNoop = handleSetSend.isNoop?.({
            type: 'setSend',
            payload: { trackId: 't1', busId: 'bus-1', level: 0.5 },
        });

        expect(isNoop).toBe(true);
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
