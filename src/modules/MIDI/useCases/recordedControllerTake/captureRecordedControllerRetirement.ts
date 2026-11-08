import { captureProjectRootIdentity } from '#/modules/CrdtDocument/useCases';

import { recordedControllerTakeState } from '../../repositories/webMidi/recordedControllerTakeState';

import { openRecordedControllerBuffer } from './openRecordedControllerBuffer';

/** Capture after the take's rising edge, never look up a later replacement owner. */
export function captureRecordedControllerRetirement(clipId: string, createOwner = false) {
    const root = captureProjectRootIdentity();
    const state = recordedControllerTakeState;
    let buffer = state.buffers.get(clipId);
    if (!buffer && createOwner) {
        buffer = openRecordedControllerBuffer(clipId) ?? undefined;
    }
    const carried = state.carriedOverClips.get(clipId);
    const seeds = [state.heldPedalSeeds, state.bendRangeSeeds, state.heldWheelSeeds].map((map) => map.get(clipId));
    let retired = false;
    const retire = () => {
        const currentBuffer = state.buffers.get(clipId);
        if (
            retired ||
            captureProjectRootIdentity() !== root ||
            (currentBuffer !== undefined && currentBuffer !== buffer) ||
            (carried !== undefined && state.carriedOverClips.get(clipId) !== carried)
        ) {
            return;
        }
        retired = true;
        const successor = state.carriedOverClips.get(clipId);
        if (buffer && successor) {
            buffer.cc.splice(0, successor.cc);
            buffer.pitchBend.splice(0, successor.pitchBend);
        } else {
            state.buffers.delete(clipId);
        }
        state.openedClipIds.delete(clipId);
        state.committedClipIds.delete(clipId);
        state.carriedOverClips.delete(clipId);
        for (const [index, map] of [state.heldPedalSeeds, state.bendRangeSeeds, state.heldWheelSeeds].entries()) {
            if (map.get(clipId) === seeds[index]) {
                map.delete(clipId);
            }
        }
    };
    return Object.assign(retire, {
        owns: () =>
            !retired &&
            captureProjectRootIdentity() === root &&
            state.buffers.get(clipId) === buffer &&
            state.carriedOverClips.get(clipId) === carried,
    });
}
