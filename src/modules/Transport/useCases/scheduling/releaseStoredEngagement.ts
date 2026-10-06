import { CC_SOSTENUTO_PEDAL, CC_SUSTAIN_PEDAL, CC_UNA_CORDA_PEDAL } from '#/utils/pianoPedalController';

import { type StoredControllerNode } from '../../models/StoredControllerNode';

type ReleaseStoredEngagementInput = {
    deviceType: string;
    node: StoredControllerNode;
    /** The controllers stored playback left engaged on this device. */
    controllers: ReadonlySet<number>;
    /** The frame the release applies at; absent, it applies at once and supersedes any framed move queued behind it. */
    sampleFrame?: number;
};

/**
 * Lift each pedal and controller stored playback left engaged on one device, each
 * through its own control. Only the controllers named are touched, so a pedal the
 * user holds live on the same device is left alone.
 */
export function releaseStoredEngagement({
    deviceType,
    node,
    controllers,
    sampleFrame,
}: ReleaseStoredEngagementInput): void {
    // The frame is passed only when there is one: an absent frame is a different
    // message to the engine (apply now, supersede what is queued), not an
    // undefined frame.
    const frame: [] | [number] = sampleFrame === undefined ? [] : [sampleFrame];
    if (deviceType === 'grand-boule' && node.grandBouleControls) {
        if (controllers.has(CC_SUSTAIN_PEDAL)) {
            node.grandBouleControls.setSustain(0, ...frame);
        }
        if (controllers.has(CC_SOSTENUTO_PEDAL)) {
            node.grandBouleControls.setSostenuto(false, ...frame);
        }
        if (controllers.has(CC_UNA_CORDA_PEDAL)) {
            node.grandBouleControls.setUnaCorda(false, ...frame);
        }
    } else if (deviceType === 'levain' && node.levainControls) {
        if (controllers.has(CC_SUSTAIN_PEDAL)) {
            node.levainControls.handleCc(CC_SUSTAIN_PEDAL, 0, ...frame);
        }
    }
}
