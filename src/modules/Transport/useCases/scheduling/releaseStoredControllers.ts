import { getTrackStrip } from '#/modules/AudioEngine/useCases';

import { takeStoredControllerEngagements } from '../../services/storedControllerEngagement';

import { releaseStoredEngagement } from './releaseStoredEngagement';

/**
 * Release every pedal and controller stored playback left engaged, on exactly the
 * devices that hold one.
 *
 * Frameless: a move with no frame applies at once and, as the newest move of its
 * pedal, makes the engine discard any framed move of stored playback still queued
 * behind it, so nothing scheduled ahead can press the pedal again after the stop.
 * A device stored playback never engaged is not in the record and gets nothing, so
 * a pedal the user holds live is left alone.
 */
export function releaseStoredControllers(): void {
    for (const engagement of takeStoredControllerEngagements()) {
        const node = getTrackStrip(engagement.trackId)?.deviceNodes.find(
            (candidate) => candidate.deviceId === engagement.deviceId
        );
        if (!node) {
            continue;
        }
        releaseStoredEngagement({
            deviceType: engagement.deviceType,
            node,
            controllers: engagement.controllers,
        });
    }
}
