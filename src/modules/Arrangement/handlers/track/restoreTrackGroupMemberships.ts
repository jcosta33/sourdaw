import { createHandler } from '#/utils/createHandler';
import { type TrackGroupMembershipSnapshot } from '#/utils/handlerContract';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { setTrackStoreState } from '../../useCases/setTrackStoreState';

// Grouping is collaboration-live: another editor (or a later macro step by the same
// user) can regroup a track between `describe()` capturing the prior map and this
// handler applying it. Every named track must still hold the value it held at capture
// time, or the whole restore is refused rather than partially applied.
function membershipsMatch(memberships: readonly TrackGroupMembershipSnapshot[]): boolean {
    const tracks = getTrackStoreState()?.tracks;
    if (!tracks) {
        return false;
    }
    return memberships.every((membership) => {
        const track = tracks.find((candidate) => candidate.id === membership.trackId);
        return track !== undefined && track.groupId === membership.groupId;
    });
}

export const handleRestoreTrackGroupMemberships = createHandler<'restoreTrackGroupMemberships'>({
    execute: (action) => {
        const state = getTrackStoreState();
        if (!state || !membershipsMatch(action.payload.expected)) {
            return { status: 'conflict' };
        }
        const replacementByTrackId = new Map(
            action.payload.replacement.map((membership) => [membership.trackId, membership] as const)
        );
        setTrackStoreState({
            ...state,
            tracks: state.tracks.map((track) => {
                const replacement = replacementByTrackId.get(track.id);
                return replacement ? { ...track, groupId: replacement.groupId } : track;
            }),
        });
        return { status: 'written' };
    },
    describe: () => ({ label: 'Restore track group memberships', inverseAction: null }),
    isNoop: (action) => membershipsMatch(action.payload.replacement),
    undoable: false,
});
