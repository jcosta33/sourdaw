import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleRestoreTrackGroupMemberships } from '../restoreTrackGroupMemberships';

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn(),
    setTrackStoreState: vi.fn(),
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('../../../useCases/setTrackStoreState', () => ({
    setTrackStoreState: mocks.setTrackStoreState,
}));

type StoreTrack = { id: string; groupId: string | null; [key: string]: unknown };

let liveTracks: StoreTrack[] = [];

function setTracks(tracks: StoreTrack[]) {
    liveTracks = tracks;
    mocks.getTrackStoreState.mockReturnValue({ tracks: liveTracks, selectedTrackId: null });
}

beforeEach(() => {
    vi.clearAllMocks();
    // `setTrackStoreState` is the module's real write path here: capture what it's
    // called with so writes can be asserted by membership value, not call presence.
    mocks.setTrackStoreState.mockImplementation((state: { tracks: StoreTrack[] }) => {
        liveTracks = state.tracks;
        mocks.getTrackStoreState.mockReturnValue({ tracks: liveTracks, selectedTrackId: null });
    });
    setTracks([
        { id: 't1', groupId: 'g1', name: 'Kick' },
        { id: 't2', groupId: 'g1', name: 'Snare' },
        { id: 't3', groupId: null, name: 'Bass' },
    ]);
});

describe('handleRestoreTrackGroupMemberships — execute', () => {
    it('writes the replacement memberships when every expected value still holds', () => {
        const result = handleRestoreTrackGroupMemberships.execute({
            type: 'restoreTrackGroupMemberships',
            payload: {
                expected: [
                    { trackId: 't1', groupId: 'g1' },
                    { trackId: 't2', groupId: 'g1' },
                ],
                replacement: [
                    { trackId: 't1', groupId: null },
                    { trackId: 't2', groupId: null },
                ],
            },
        });

        expect(result).toEqual({ status: 'written' });
        // Assert the actual membership values landed in the store, not just that the
        // write function was invoked.
        expect(mocks.getTrackStoreState()?.tracks).toEqual([
            { id: 't1', groupId: null, name: 'Kick' },
            { id: 't2', groupId: null, name: 'Snare' },
            { id: 't3', groupId: null, name: 'Bass' },
        ]);
    });

    it('conflicts rather than overwriting when one track live groupId changed since capture', () => {
        // Simulate a collaborator's edit landing between describe() capturing the
        // expected state and this restore executing: t2 has since been moved to g2.
        setTracks([
            { id: 't1', groupId: 'g1', name: 'Kick' },
            { id: 't2', groupId: 'g2', name: 'Snare' },
            { id: 't3', groupId: null, name: 'Bass' },
        ]);

        const result = handleRestoreTrackGroupMemberships.execute({
            type: 'restoreTrackGroupMemberships',
            payload: {
                expected: [
                    { trackId: 't1', groupId: 'g1' },
                    { trackId: 't2', groupId: 'g1' },
                ],
                replacement: [
                    { trackId: 't1', groupId: null },
                    { trackId: 't2', groupId: null },
                ],
            },
        });

        expect(result).toEqual({ status: 'conflict' });
    });

    it('applies nothing to the store when it conflicts', () => {
        setTracks([
            { id: 't1', groupId: 'g1', name: 'Kick' },
            { id: 't2', groupId: 'g2', name: 'Snare' },
            { id: 't3', groupId: null, name: 'Bass' },
        ]);

        handleRestoreTrackGroupMemberships.execute({
            type: 'restoreTrackGroupMemberships',
            payload: {
                expected: [
                    { trackId: 't1', groupId: 'g1' },
                    { trackId: 't2', groupId: 'g1' },
                ],
                replacement: [
                    { trackId: 't1', groupId: null },
                    { trackId: 't2', groupId: null },
                ],
            },
        });

        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
        expect(mocks.getTrackStoreState()?.tracks).toEqual([
            { id: 't1', groupId: 'g1', name: 'Kick' },
            { id: 't2', groupId: 'g2', name: 'Snare' },
            { id: 't3', groupId: null, name: 'Bass' },
        ]);
    });

    it('conflicts when an expected track no longer exists', () => {
        setTracks([{ id: 't1', groupId: 'g1', name: 'Kick' }]);

        const result = handleRestoreTrackGroupMemberships.execute({
            type: 'restoreTrackGroupMemberships',
            payload: {
                expected: [
                    { trackId: 't1', groupId: 'g1' },
                    { trackId: 't2', groupId: 'g1' },
                ],
                replacement: [
                    { trackId: 't1', groupId: null },
                    { trackId: 't2', groupId: null },
                ],
            },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
    });

    it('conflicts when the track store is unavailable', () => {
        mocks.getTrackStoreState.mockReturnValue(null);

        const result = handleRestoreTrackGroupMemberships.execute({
            type: 'restoreTrackGroupMemberships',
            payload: {
                expected: [{ trackId: 't1', groupId: 'g1' }],
                replacement: [{ trackId: 't1', groupId: null }],
            },
        });

        expect(result).toEqual({ status: 'conflict' });
    });
});

describe('handleRestoreTrackGroupMemberships — isNoop', () => {
    it('returns true when the replacement already matches live state', () => {
        expect(
            handleRestoreTrackGroupMemberships.isNoop!({
                type: 'restoreTrackGroupMemberships',
                payload: {
                    expected: [{ trackId: 't1', groupId: null }],
                    replacement: [{ trackId: 't1', groupId: 'g1' }],
                },
            })
        ).toBe(true);
    });

    it('returns false when the replacement differs from live state', () => {
        expect(
            handleRestoreTrackGroupMemberships.isNoop!({
                type: 'restoreTrackGroupMemberships',
                payload: {
                    expected: [{ trackId: 't1', groupId: 'g1' }],
                    replacement: [{ trackId: 't1', groupId: null }],
                },
            })
        ).toBe(false);
    });
});

describe('handleRestoreTrackGroupMemberships — describe', () => {
    it('returns a label with a null inverse', () => {
        const result = handleRestoreTrackGroupMemberships.describe({
            type: 'restoreTrackGroupMemberships',
            payload: { expected: [], replacement: [] },
        });
        expect(result.label).toBe('Restore track group memberships');
        expect(result.inverseAction).toBeNull();
    });

    it('is not undoable', () => {
        expect(handleRestoreTrackGroupMemberships.undoable).toBe(false);
    });
});
