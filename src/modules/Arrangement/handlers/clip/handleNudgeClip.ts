import { createHandler } from '#/utils/createHandler';

import { nudgeClip } from '../../useCases/clipEditing/nudgeClip';
import { planClipNudge } from '../../useCases/clipEditing/planClipNudge';
import { readClipPlacement } from '../../useCases/clipEditing/readClipPlacement';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

import { readPlannedClip } from './readPlannedClip';

function liveStartBeat(clipId: string): number | undefined {
    return getTrackStoreState()
        ?.tracks.flatMap((track) => track.clips)
        .find((candidate) => candidate.id === clipId)?.startBeat;
}

export const handleNudgeClip = createHandler<'nudgeClip'>({
    canReapplyAfterDivergence: (alpha) => alpha.payload.expectedStartBeat !== undefined,
    validate: (alpha, context) =>
        alpha.payload.expectedStartBeat === undefined ||
        readPlannedClip(alpha.payload.clipId, context)?.startBeat === alpha.payload.expectedStartBeat,
    execute: (alpha) => {
        if (
            alpha.payload.expectedStartBeat !== undefined &&
            liveStartBeat(alpha.payload.clipId) !== alpha.payload.expectedStartBeat
        ) {
            return { status: 'conflict' };
        }
        if (alpha.payload.placement) {
            return toHandlerExecutionResult(
                nudgeClip(alpha.payload.clipId, alpha.payload.beats, alpha.payload.placement)
            );
        }
        return toHandlerExecutionResult(nudgeClip(alpha.payload.clipId, alpha.payload.beats));
    },
    describe: (alpha, context) => {
        const label = `Nudge clip ${alpha.payload.beats > 0 ? 'right' : 'left'}`;
        try {
            const clip = readPlannedClip(alpha.payload.clipId, context);
            if (!clip) {
                return { label, inverseAction: null };
            }
            // The forward nudge clamps at beat 0 and shifts MIDI notes/automation by
            // the applied delta, so the recorded legs carry the exact placement they
            // write: undo restores the prior beats bit-for-bit and each leg expects
            // exactly the start the other wrote, whatever the float rounding of a
            // relative delta. A locked clip is not moved, so both placements are equal.
            const before = readClipPlacement(clip);
            const after = planClipNudge(clip, alpha.payload.beats, alpha.payload.placement);
            return {
                label,
                inverseAction: {
                    type: 'nudgeClip',
                    payload: {
                        clipId: alpha.payload.clipId,
                        beats: before.startBeat - after.startBeat,
                        expectedStartBeat: after.startBeat,
                        placement: before,
                    },
                },
                redoAction: {
                    type: 'nudgeClip',
                    payload: {
                        clipId: alpha.payload.clipId,
                        beats: alpha.payload.beats,
                        expectedStartBeat: before.startBeat,
                        placement: after,
                    },
                },
            };
        } catch {
            return { label, inverseAction: null };
        }
    },
    undoable: true,
});
