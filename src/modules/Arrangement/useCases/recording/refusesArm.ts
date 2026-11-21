import { notifyUser } from '#/utils/Notification/notifyUser';

import { FROZEN_TRACK_RECORDING_MESSAGE, isFrozenTrackRefusingRecording } from '../../stores/frozenTrackRecording';
import { getTrackEligibility } from '../../stores/trackEligibility';

import type { Track } from '../../models/Track';

/**
 * Whether arming this track must be refused: its kind cannot record, or it is
 * frozen and would record silent takes. Only a fresh user arm is refused for a
 * frozen track: `replay` (undo, redo, an isolated preview) restores or projects
 * a state the user already had, so it is neither refused nor reported.
 */
export function refusesArm(
    track: Pick<Track, 'kind' | 'frozen'>,
    request: { armed: boolean; replay: boolean }
): boolean {
    const { armed, replay } = request;
    if (!armed) {
        return false;
    }
    if (!getTrackEligibility(track.kind).acceptsArm) {
        return true;
    }
    if (replay || !isFrozenTrackRefusingRecording(track)) {
        return false;
    }
    notifyUser(FROZEN_TRACK_RECORDING_MESSAGE, 'warning');
    return true;
}
