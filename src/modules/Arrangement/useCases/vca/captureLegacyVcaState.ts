import { type AppAction } from '#/utils/handlerContract';

import { getVcaGroupsState } from '../../stores/vcaGroupStore';
import { getAllTracks } from '../getAllTracks';

type RestoreLegacyVcaStateAction = Extract<AppAction, { type: 'restoreLegacyVcaState' }>;

export function captureLegacyVcaState(): RestoreLegacyVcaStateAction['payload'] {
    return {
        groups: getVcaGroupsState().map((group) => ({
            ...group,
            trackIds: [...group.trackIds],
        })),
        trackMemberships: getAllTracks().map((track) => ({
            trackId: track.id,
            vcaGroupId: track.vcaGroupId ?? null,
        })),
    };
}
