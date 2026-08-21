import { createHandler } from '#/utils/createHandler';
import { type TrackGroupMembershipSnapshot } from '#/utils/handlerContract';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { groupTracks } from '../../useCases/toggleTrackState/groupTracks';

type MutableGroupMembership = { trackId: string; groupId: string | null };

// The group id this action assigns is minted inside the use case (`group-${Date.now()}`),
// so `describe()` cannot know the post-state before `execute()` runs. Seed placeholders
// carrying the prior groupId here and let `execute()` overwrite each with the id the
// write actually produced — the same describe-then-finalize pattern `handleFreezeTrack`
// uses to guard its own non-deterministic inverse. Keyed by action so concurrent grouping
// commands cannot cross.
const pendingGroupSnapshots = new WeakMap<object, MutableGroupMembership[]>();

function captureNamedMemberships(trackIds: readonly string[]): TrackGroupMembershipSnapshot[] | null {
    const tracks = getTrackStoreState()?.tracks;
    if (!tracks) {
        return null;
    }
    const named = tracks.filter((track) => trackIds.includes(track.id));
    return named.length > 0 ? named.map((track) => ({ trackId: track.id, groupId: track.groupId })) : null;
}

export const handleGroupTracks = createHandler<'groupTracks'>({
    execute: (action) => {
        groupTracks(action.payload.trackIds, action.payload.name);
        const pending = pendingGroupSnapshots.get(action);
        if (pending) {
            const tracks = getTrackStoreState()?.tracks ?? [];
            for (const membership of pending) {
                const track = tracks.find((candidate) => candidate.id === membership.trackId);
                if (track) {
                    membership.groupId = track.groupId;
                }
            }
        }
    },
    describe: (action) => {
        const previous = captureNamedMemberships(action.payload.trackIds);
        if (!previous) {
            return { label: `Group tracks: "${action.payload.name}"`, inverseAction: null };
        }
        // Seeded with the prior groupId; `execute()` replaces each entry with the id the
        // write actually assigns once it resolves.
        const settled: MutableGroupMembership[] = previous.map((membership) => ({ ...membership }));
        pendingGroupSnapshots.set(action, settled);
        return {
            label: `Group tracks: "${action.payload.name}"`,
            inverseAction: {
                type: 'restoreTrackGroupMemberships',
                payload: { expected: settled, replacement: previous },
            },
            redoAction: {
                type: 'restoreTrackGroupMemberships',
                payload: { expected: previous, replacement: settled },
            },
        };
    },
    // Grouping always mints a fresh id, so the only case that changes nothing is when
    // none of the named ids resolve to a live track.
    isNoop: (action) => captureNamedMemberships(action.payload.trackIds) === null,
    undoable: true,
});
