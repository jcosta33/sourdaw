import { captureProjectRootIdentity } from '#/modules/CrdtDocument/useCases';
import { transportStore } from '#/modules/Transport/stores';

import {
    type RecordedControllerBuffer,
    recordedControllerTakeState,
} from '../../repositories/webMidi/recordedControllerTakeState';

import { endRecordedControllerTake } from './endRecordedControllerTake';
import { planRecordedControllers } from './planRecordedControllers';
import { writeRecordedControllerRows } from './writeRecordedControllerRows';

function hasCapturedPrefix(
    buffer: RecordedControllerBuffer | undefined,
    ccIds: readonly string[],
    bendIds: readonly string[]
): boolean {
    if (!buffer) {
        return true;
    }
    return (
        ccIds.every((id, index) => buffer.cc[index]?.id === id) &&
        bendIds.every((id, index) => buffer.pitchBend[index]?.id === id)
    );
}

/** Plan once; publication alone consumes this captured owner's runtime prefix. */
export function prepareRecordedControllersCommit(input: Parameters<typeof planRecordedControllers>[0]) {
    const clipId = input.clip.id;
    const root = captureProjectRootIdentity();
    const state = recordedControllerTakeState;
    const buffer = state.buffers.get(clipId);
    const carried = state.carriedOverClips.get(clipId);
    const ccIds = buffer?.cc.map((row) => row.id) ?? [];
    const bendIds = buffer?.pitchBend.map((row) => row.id) ?? [];
    const seeds = [state.heldPedalSeeds, state.bendRangeSeeds, state.heldWheelSeeds].map((map) => map.get(clipId));
    const rows = structuredClone(planRecordedControllers(input));
    let finished = false;

    async function finish(): Promise<void> {
        if (finished) {
            return;
        }
        finished = true;
        if (
            captureProjectRootIdentity() !== root ||
            state.buffers.get(clipId) !== buffer ||
            state.carriedOverClips.get(clipId) !== carried
        ) {
            return;
        }
        if (!hasCapturedPrefix(buffer, ccIds, bendIds)) {
            return;
        }
        buffer?.cc.splice(0, ccIds.length);
        buffer?.pitchBend.splice(0, bendIds.length);
        const hasSuffix = !!buffer && (buffer.cc.length > 0 || buffer.pitchBend.length > 0);
        if (!hasSuffix) {
            state.buffers.delete(clipId);
        }
        if (carried) {
            state.carriedOverClips.delete(clipId);
        }
        if (carried || hasSuffix) {
            state.openedClipIds.delete(clipId);
        } else {
            state.committedClipIds.add(clipId);
        }
        for (const [index, map] of [state.heldPedalSeeds, state.bendRangeSeeds, state.heldWheelSeeds].entries()) {
            if (map.get(clipId) === seeds[index]) {
                map.delete(clipId);
            }
        }
        if (hasSuffix && transportStore.value?.isRecording !== true) {
            await endRecordedControllerTake();
        }
    }

    return {
        rows,
        write: () => writeRecordedControllerRows({ clipId, ...rows }),
        finish,
    };
}
