import { executeAppAction, isAppActionConflictError } from '#/modules/Command/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { takeLaneStore } from '../../stores/takeLaneStore';

/** A promotion caller must not write its comp region after a refused selection. */
export async function selectTake(trackId: string, takeId: string): Promise<boolean> {
    const lane = takeLaneStore.value?.lanes.find((candidate) => candidate.trackId === trackId);
    if (!lane) {
        notifyUser(
            'Select take was refused because the take lane changed or the project cannot be changed right now.',
            'warning'
        );
        return false;
    }
    try {
        await executeAppAction({
            type: 'selectTake',
            payload: {
                trackId,
                takeId,
                expectedLaneId: lane.id,
                expectedSelectedTakeId: lane.takes.find((take) => take.selected)?.id ?? null,
            },
        });
        return true;
    } catch (error) {
        if (!isAppActionConflictError(error)) {
            throw error;
        }
        notifyUser(
            'Select take was refused because the take lane changed or the project cannot be changed right now.',
            'warning'
        );
        return false;
    }
}
