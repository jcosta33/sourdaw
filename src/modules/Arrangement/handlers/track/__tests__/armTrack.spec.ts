import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleArmTrack } from '../armTrack';

const mocks = vi.hoisted(() => ({
    armTrack: vi.fn(),
    getMidiInputTrack: vi.fn<() => string | null>(),
    getMidiInputTrackOwnerId: vi.fn<() => string | null>(),
    getTrackStoreState: vi.fn<() => { tracks: { id: string; armed: boolean; kind: 'audio' | 'midi' }[] } | null>(),
}));

vi.mock('../../../useCases/recording/armTrack', () => ({
    armTrack: mocks.armTrack,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    getMidiInputTrack: mocks.getMidiInputTrack,
    getMidiInputTrackOwnerId: mocks.getMidiInputTrackOwnerId,
}));

describe('handleArmTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getMidiInputTrack.mockReturnValue(null);
        mocks.getMidiInputTrackOwnerId.mockReturnValue(null);
        mocks.getTrackStoreState.mockReturnValue(null);
    });

    it('defers the MIDI runtime effect and returns both commit callbacks', () => {
        const afterCommit = vi.fn();
        const afterAmbiguousCommit = vi.fn();
        mocks.armTrack.mockReturnValue({ afterCommit, afterAmbiguousCommit });

        const result = handleArmTrack.execute({
            type: 'armTrack',
            payload: { trackId: 't1', armed: true, midiInputOwnerId: 'owner-forward' },
        });

        expect(mocks.armTrack).toHaveBeenCalledWith('t1', true, {
            deferRuntimeEffect: true,
            midiInputTrackId: undefined,
            expectedMidiInputTrackId: undefined,
            midiInputOwnerId: 'owner-forward',
            expectedMidiInputOwnerId: undefined,
        });
        expect(result).toEqual({ status: 'written', afterCommit, afterAmbiguousCommit });
    });

    it('passes the inverse-only MIDI route through deferred execution', () => {
        const afterCommit = vi.fn();
        const afterAmbiguousCommit = vi.fn();
        mocks.armTrack.mockReturnValue({ afterCommit, afterAmbiguousCommit });

        void handleArmTrack.execute({
            type: 'armTrack',
            payload: {
                trackId: 't1',
                armed: false,
                midiInputTrackId: 't0',
                expectedMidiInputTrackId: 't1',
                midiInputOwnerId: null,
                expectedMidiInputOwnerId: 'owner-forward',
            },
        });

        expect(mocks.armTrack).toHaveBeenCalledWith('t1', false, {
            deferRuntimeEffect: true,
            midiInputTrackId: 't0',
            expectedMidiInputTrackId: 't1',
            midiInputOwnerId: null,
            expectedMidiInputOwnerId: 'owner-forward',
        });
    });

    it('reports no-write when arming is rejected', () => {
        mocks.armTrack.mockReturnValue(null);

        const result = handleArmTrack.execute({
            type: 'armTrack',
            payload: { trackId: 'vca-1', armed: true },
        });

        expect(result).toEqual({ status: 'no-write' });
    });

    it('reports permitted disarm cleanup as a write', () => {
        const afterCommit = vi.fn();
        const afterAmbiguousCommit = vi.fn();
        mocks.armTrack.mockReturnValue({ afterCommit, afterAmbiguousCommit });

        const result = handleArmTrack.execute({
            type: 'armTrack',
            payload: { trackId: 'vca-1', armed: false },
        });

        expect(result).toEqual({ status: 'written', afterCommit, afterAmbiguousCommit });
    });

    it('identifies matching project truth as a no-op', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', armed: true, kind: 'midi' }] });

        expect(handleArmTrack.isNoop?.({ type: 'armTrack', payload: { trackId: 't1', armed: true } })).toBe(true);
        expect(handleArmTrack.isNoop?.({ type: 'armTrack', payload: { trackId: 't1', armed: false } })).toBe(false);
    });

    it('executes a route-only inverse only while its expected route owner still matches', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', armed: false, kind: 'midi' }] });
        const inverseAction = {
            type: 'armTrack' as const,
            payload: {
                trackId: 't1',
                armed: false,
                midiInputTrackId: 't0',
                expectedMidiInputTrackId: 't1',
                midiInputOwnerId: null,
                expectedMidiInputOwnerId: 'owner-forward',
            },
        };

        mocks.getMidiInputTrack.mockReturnValue('t1');
        mocks.getMidiInputTrackOwnerId.mockReturnValue('owner-forward');
        expect(handleArmTrack.isNoop?.(inverseAction)).toBe(false);

        mocks.getMidiInputTrack.mockReturnValue('t2');
        expect(handleArmTrack.isNoop?.(inverseAction)).toBe(true);

        mocks.getMidiInputTrack.mockReturnValue('t1');
        mocks.getMidiInputTrackOwnerId.mockReturnValue(null);
        expect(handleArmTrack.isNoop?.(inverseAction)).toBe(true);
    });

    it('does not classify a missing track as a no-op', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });

        expect(handleArmTrack.isNoop?.({ type: 'armTrack', payload: { trackId: 'missing', armed: true } })).toBe(false);
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

    it('describes an inverse restoring project state and the exact MIDI route owner', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', armed: false, kind: 'midi' }] });
        mocks.getMidiInputTrack.mockReturnValue('t0');
        mocks.getMidiInputTrackOwnerId.mockReturnValue('owner-before');

        const desc = handleArmTrack.describe({
            type: 'armTrack',
            payload: { trackId: 't1', armed: true, midiInputOwnerId: 'owner-forward' },
        });

        expect(desc.inverseAction).toEqual({
            type: 'armTrack',
            payload: {
                trackId: 't1',
                armed: false,
                midiInputTrackId: 't0',
                expectedMidiInputTrackId: 't1',
                midiInputOwnerId: 'owner-before',
                expectedMidiInputOwnerId: 'owner-forward',
            },
        });
    });

    it('describes a route-only inverse with the forward route owner as its expectation', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', armed: false, kind: 'midi' }] });
        mocks.getMidiInputTrack.mockReturnValue('t1');
        mocks.getMidiInputTrackOwnerId.mockReturnValue('owner-forward');

        const desc = handleArmTrack.describe({
            type: 'armTrack',
            payload: {
                trackId: 't1',
                armed: false,
                midiInputTrackId: 't0',
                expectedMidiInputTrackId: 't1',
                midiInputOwnerId: null,
                expectedMidiInputOwnerId: 'owner-forward',
            },
        });

        expect(desc.inverseAction).toEqual({
            type: 'armTrack',
            payload: {
                trackId: 't1',
                armed: false,
                midiInputTrackId: 't1',
                expectedMidiInputTrackId: 't0',
                midiInputOwnerId: 'owner-forward',
                expectedMidiInputOwnerId: null,
            },
        });
    });

    it('does not negate project state when describing a matching arm', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', armed: true, kind: 'midi' }] });

        const desc = handleArmTrack.describe({
            type: 'armTrack',
            payload: { trackId: 't1', armed: true, midiInputOwnerId: 'owner-forward' },
        });

        expect(desc.inverseAction).toEqual({
            type: 'armTrack',
            payload: {
                trackId: 't1',
                armed: true,
                midiInputTrackId: null,
                expectedMidiInputTrackId: 't1',
                midiInputOwnerId: null,
                expectedMidiInputOwnerId: 'owner-forward',
            },
        });
    });

    it('is undoable without pre-commit abort compensation', () => {
        expect(handleArmTrack.undoable).toBe(true);
        expect(handleArmTrack.requiresAbortCompensation).toBe(false);
    });
});
