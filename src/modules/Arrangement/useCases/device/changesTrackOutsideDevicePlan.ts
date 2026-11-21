import { type AppAction } from '#/utils/handlerContract';

import { unplannedTrackChangeByActionType } from '../../models/UnplannedTrackChangeByActionType';

/** Whether this action changes the track outside what a planned device patch can project. */
export function changesTrackOutsideDevicePlan(action: AppAction, trackId: string): boolean {
    if (
        !Object.hasOwn(unplannedTrackChangeByActionType, action.type) ||
        !unplannedTrackChangeByActionType[action.type]
    ) {
        return false;
    }
    if (!action.payload || !('trackId' in action.payload)) {
        return false;
    }
    return action.payload.trackId === trackId;
}
