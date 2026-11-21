import { notifyUser } from '#/utils/Notification/notifyUser';

import { FROZEN_TRACK_RECORDING_MESSAGE, isFrozenTrackRefusingRecording } from '../../models/FrozenTrackRecording';
import { getTrackEligibility } from '../../stores/trackEligibility';

import type { Track } from '../../models/Track';

/** Whether arming this track must be refused: its kind cannot record, or it is frozen and would record silent takes. */
export function refusesArm(track: Pick<Track, 'kind' | 'frozen'>, armed: boolean): boolean {
    if (!armed) {
        return false;
    }
    if (!getTrackEligibility(track.kind).acceptsArm) {
        return true;
    }
    if (!isFrozenTrackRefusingRecording(track)) {
        return false;
    }
    notifyUser(FROZEN_TRACK_RECORDING_MESSAGE, 'warning');
    return true;
}
