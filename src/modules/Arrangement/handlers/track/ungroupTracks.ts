import { createHandler } from '#/utils/createHandler';
import { type TrackGroupMembershipSnapshot } from '#/utils/handlerContract';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { ungroupTracks } from '../../useCases/toggleTrackState/ungroupTracks';

function captureGroupedMemberships(groupId: string): TrackGroupMembershipSnapshot[] {
    const tracks = getTrackStoreState()?.tracks ?? [];
    return tracks
        .filter((track) => track.groupId === groupId)
        .map((track) => ({ trackId: track.id, groupId: track.groupId }));
}

export const handleUngroupTracks = createHandler<'ungroupTracks'>({
    execute: (action) => {
        const grouped = captureGroupedMemberships(action.payload.groupId);
        if (grouped.length === 0) {
            return { status: 'no-write' };
        }
        ungroupTracks(action.payload.groupId);
        return { status: 'written' };
    },
    describe: (action) => {
        const grouped = captureGroupedMemberships(action.payload.groupId);
        if (grouped.length === 0) {
            return { label: 'Ungroup tracks', inverseAction: null };
        }
        const ungrouped: TrackGroupMembershipSnapshot[] = grouped.map((membership) => ({
            trackId: membership.trackId,
            groupId: null,
        }));
        return {
            label: 'Ungroup tracks',
            inverseAction: {
                type: 'restoreTrackGroupMemberships',
                payload: { expected: ungrouped, replacement: grouped },
            },
            redoAction: {
                type: 'restoreTrackGroupMemberships',
                payload: { expected: grouped, replacement: ungrouped },
            },
        };
    },
    isNoop: (action) => captureGroupedMemberships(action.payload.groupId).length === 0,
    undoable: true,
});
