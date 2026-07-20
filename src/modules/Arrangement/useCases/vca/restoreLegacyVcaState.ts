import { type AppAction } from '#/utils/handlerContract';

import { setVcaGroupsState } from '../../stores/vcaGroupStore';
import { getTrackStoreState } from '../getTrackStoreState';
import { setTrackStoreState } from '../setTrackStoreState';

import { captureLegacyVcaState } from './captureLegacyVcaState';

type RestoreLegacyVcaStateAction = Extract<AppAction, { type: 'restoreLegacyVcaState' }>;

export function restoreLegacyVcaState(snapshot: RestoreLegacyVcaStateAction['payload']): boolean {
    const currentSnapshot = captureLegacyVcaState();
    const groupsChanged = JSON.stringify(currentSnapshot.groups) !== JSON.stringify(snapshot.groups);
    const trackMembershipsChanged =
        JSON.stringify(currentSnapshot.trackMemberships) !== JSON.stringify(snapshot.trackMemberships);
    if (!groupsChanged && !trackMembershipsChanged) {
        return false;
    }

    if (groupsChanged) {
        setVcaGroupsState(
            snapshot.groups.map((group) => ({
                ...group,
                trackIds: [...group.trackIds],
            }))
        );
    }

    if (trackMembershipsChanged) {
        const trackState = getTrackStoreState();
        if (trackState) {
            const membershipByTrackId = new Map(
                snapshot.trackMemberships.map((membership) => [membership.trackId, membership.vcaGroupId])
            );
            setTrackStoreState({
                ...trackState,
                tracks: trackState.tracks.map((track) => ({
                    ...track,
                    vcaGroupId: membershipByTrackId.get(track.id) ?? null,
                })),
            });
        }
    }

    return true;
}
