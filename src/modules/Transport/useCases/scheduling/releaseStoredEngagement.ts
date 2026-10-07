import { CC_SOSTENUTO_PEDAL, CC_SUSTAIN_PEDAL, CC_UNA_CORDA_PEDAL } from '#/utils/pianoPedalController';

import { type StoredControllerNode } from '../../models/StoredControllerNode';

type ReleaseStoredEngagementInput = {
    deviceType: string;
    node: StoredControllerNode;
    /** The controllers stored playback left engaged on this device. */
    controllers: ReadonlySet<number>;
    /** The frame the release applies at; absent, it applies at once. */
    sampleFrame?: number;
};

/**
 * Lift each pedal and controller stored playback left engaged on one device, each
 * through its own control. Only the controllers named are touched, so a pedal the
 * user holds live on the same device is left alone.
 *
 * The lift is itself a stored move: it speaks for stored playback only, so it does
 * not supersede a performer's queued moves of the pedal. Whatever stored moves are
 * still queued behind it are dropped by the caller's `discardStoredMoves` first.
 */
export function releaseStoredEngagement({
    deviceType,
    node,
    controllers,
    sampleFrame,
}: ReleaseStoredEngagementInput): void {
    if (deviceType === 'grand-boule' && node.grandBouleControls) {
        if (controllers.has(CC_SUSTAIN_PEDAL)) {
            node.grandBouleControls.setSustain(0, sampleFrame, true);
        }
        if (controllers.has(CC_SOSTENUTO_PEDAL)) {
            node.grandBouleControls.setSostenuto(false, sampleFrame, true);
        }
        if (controllers.has(CC_UNA_CORDA_PEDAL)) {
            node.grandBouleControls.setUnaCorda(false, sampleFrame, true);
        }
    } else if (deviceType === 'levain' && node.levainControls) {
        if (controllers.has(CC_SUSTAIN_PEDAL)) {
            node.levainControls.handleCc(CC_SUSTAIN_PEDAL, 0, sampleFrame, true);
        }
    }
}
