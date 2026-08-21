import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleGroupTracks } from '../groupTracks';

const mocks = vi.hoisted(() => ({
    groupTracks: vi.fn(),
    getTrackStoreState: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/toggleTrackState/groupTracks', () => ({
    groupTracks: mocks.groupTracks,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

function setTracks(tracks: Array<{ id: string; groupId: string | null }> | null) {
    mocks.getTrackStoreState.mockReturnValue(tracks ? { tracks } : null);
}

describe('handleGroupTracks', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setTracks([
            { id: 't1', groupId: null },
            { id: 't2', groupId: null },
        ]);
    });

    it('executes groupTracks with the provided payload', () => {
        void handleGroupTracks.execute({
            type: 'groupTracks',
            payload: { trackIds: ['t1', 't2'], name: 'Guitars' },
        });

        expect(mocks.groupTracks).toHaveBeenCalledWith(['t1', 't2'], 'Guitars');
    });

    it('provides a description reflecting the group name', () => {
        const desc = handleGroupTracks.describe({
            type: 'groupTracks',
            payload: { trackIds: ['t1', 't2'], name: 'Guitars' },
        });
        expect(desc.label).toBe('Group tracks: "Guitars"');
    });

    it('is undoable', () => {
        expect(handleGroupTracks.undoable).toBe(true);
    });

    it('captures the prior membership map as the inverse replacement, and finalizes the resolved group id after execute', () => {
        setTracks([
            { id: 't1', groupId: 'old-group' },
            { id: 't2', groupId: null },
        ]);
        const action = {
            type: 'groupTracks' as const,
            payload: { trackIds: ['t1', 't2'], name: 'Guitars' },
        };
        const description = handleGroupTracks.describe(action);

        // Pre-state is captured before execute runs, and lands as the inverse's
        // replacement / the redo's expected value.
        expect(description.inverseAction).toMatchObject({
            type: 'restoreTrackGroupMemberships',
            payload: {
                replacement: [
                    { trackId: 't1', groupId: 'old-group' },
                    { trackId: 't2', groupId: null },
                ],
            },
        });
        expect(description.redoAction).toMatchObject({
            type: 'restoreTrackGroupMemberships',
            payload: {
                expected: [
                    { trackId: 't1', groupId: 'old-group' },
                    { trackId: 't2', groupId: null },
                ],
            },
        });

        mocks.groupTracks.mockImplementation(() => {
            setTracks([
                { id: 't1', groupId: 'group-123' },
                { id: 't2', groupId: 'group-123' },
            ]);
        });

        void handleGroupTracks.execute(action);

        // The group id is only known once execute() resolves it. describe() returned the
        // same objects execute() finalizes, so the already-emitted inverse/redo actions
        // observe the resolved id rather than a placeholder.
        expect(description.inverseAction).toMatchObject({
            payload: {
                expected: [
                    { trackId: 't1', groupId: 'group-123' },
                    { trackId: 't2', groupId: 'group-123' },
                ],
            },
        });
        expect(description.redoAction).toMatchObject({
            payload: {
                replacement: [
                    { trackId: 't1', groupId: 'group-123' },
                    { trackId: 't2', groupId: 'group-123' },
                ],
            },
        });
    });

    it('emits no inverse when none of the named tracks exist', () => {
        setTracks([]);
        expect(
            handleGroupTracks.describe({
                type: 'groupTracks',
                payload: { trackIds: ['missing'], name: 'Guitars' },
            })
        ).toEqual({ label: 'Group tracks: "Guitars"', inverseAction: null });
    });

    it('reports a no-op when no named track exists', () => {
        setTracks([]);
        expect(
            handleGroupTracks.isNoop?.({
                type: 'groupTracks',
                payload: { trackIds: ['missing'], name: 'Guitars' },
            })
        ).toBe(true);
    });

    it('is not a no-op when a named track exists', () => {
        expect(
            handleGroupTracks.isNoop?.({
                type: 'groupTracks',
                payload: { trackIds: ['t1'], name: 'Guitars' },
            })
        ).toBe(false);
    });
});
