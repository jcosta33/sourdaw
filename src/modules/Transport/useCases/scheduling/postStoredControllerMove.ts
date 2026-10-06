import { CC_SUSTAIN_PEDAL, isPianoPedalMoveEngaged, resolvePianoPedalMove } from '#/utils/pianoPedalController';

import { type StoredControllerNode } from '../../models/StoredControllerNode';
import { noteStoredControllerMove, noteStoredControllerPost } from '../../services/storedControllerEngagement';

type PostStoredControllerMoveInput = {
    trackId: string;
    device: { id: string; type: string };
    node: StoredControllerNode;
    controller: number;
    value: number;
    sampleFrame: number;
};

/**
 * Post one stored controller move to the instrument that honours it, at its own
 * sample frame, and record what it leaves engaged so a stop or a relocation can
 * release it.
 *
 * Grand Boule takes CC64 as a sustain position and CC66 / CC67 as latches; any
 * other controller is not a pedal and is ignored. Levain takes the raw controller
 * byte, and only its sustain pedal is a held pedal: another Levain controller is
 * left where the lane put it. Every other instrument ignores stored controllers.
 */
export function postStoredControllerMove({
    trackId,
    device,
    node,
    controller,
    value,
    sampleFrame,
}: PostStoredControllerMoveInput): void {
    const grandBoule = device.type === 'grand-boule' ? node.grandBouleControls : undefined;
    if (grandBoule) {
        const pedal = resolvePianoPedalMove(controller, value);
        if (pedal === null) {
            return;
        }
        if (pedal.pedal === 'sustain') {
            grandBoule.setSustain(pedal.position, sampleFrame, true);
        } else if (pedal.pedal === 'sostenuto') {
            grandBoule.setSostenuto(pedal.engaged, sampleFrame, true);
        } else {
            grandBoule.setUnaCorda(pedal.engaged, sampleFrame, true);
        }
        noteStoredControllerPost({ trackId, deviceId: device.id, deviceType: device.type, pedal: controller });
        noteStoredControllerMove({
            trackId,
            deviceId: device.id,
            deviceType: device.type,
            controller,
            engaged: isPianoPedalMoveEngaged(pedal),
        });
        return;
    }
    const levain = device.type === 'levain' ? node.levainControls : undefined;
    if (!levain) {
        return;
    }
    levain.handleCc(controller, value, sampleFrame, true);
    const isPedal = controller === CC_SUSTAIN_PEDAL;
    noteStoredControllerPost({
        trackId,
        deviceId: device.id,
        deviceType: device.type,
        pedal: isPedal ? controller : undefined,
        controller: isPedal ? undefined : controller,
    });
    if (controller === CC_SUSTAIN_PEDAL) {
        noteStoredControllerMove({
            trackId,
            deviceId: device.id,
            deviceType: device.type,
            controller,
            engaged: value > 0,
        });
    }
}
