import { getTrackStrip } from '#/modules/AudioEngine/useCases';
import { CC_SOSTENUTO_PEDAL, CC_SUSTAIN_PEDAL, CC_UNA_CORDA_PEDAL } from '#/utils/pianoPedalController';

import { takeStoredControllerEngagements } from '../../services/storedControllerEngagement';

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
        if (engagement.deviceType === 'grand-boule' && node.grandBouleControls) {
            if (engagement.controllers.has(CC_SUSTAIN_PEDAL)) {
                node.grandBouleControls.setSustain(0);
            }
            if (engagement.controllers.has(CC_SOSTENUTO_PEDAL)) {
                node.grandBouleControls.setSostenuto(false);
            }
            if (engagement.controllers.has(CC_UNA_CORDA_PEDAL)) {
                node.grandBouleControls.setUnaCorda(false);
            }
        } else if (engagement.deviceType === 'levain' && node.levainControls) {
            if (engagement.controllers.has(CC_SUSTAIN_PEDAL)) {
                node.levainControls.handleCc(CC_SUSTAIN_PEDAL, 0);
            }
        }
    }
}
