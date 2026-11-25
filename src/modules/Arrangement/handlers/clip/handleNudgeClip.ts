import { createHandler } from '#/utils/createHandler';

import { nudgeClip } from '../../useCases/clipEditing/nudgeClip';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { nudgeAppliedBeats } from '../projectClipFieldActions';
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
            // the applied delta, so the inverse must negate the applied post-clamp
            // delta — not the requested one — or undo/redo drift the notes off the
            // clip rectangle. A locked clip is not moved, so its applied delta is zero.
            const applied = nudgeAppliedBeats(clip, alpha.payload.beats);
            return {
                label,
                inverseAction: {
                    type: 'nudgeClip',
                    payload: {
                        clipId: alpha.payload.clipId,
                        beats: applied === 0 ? 0 : -applied,
                        expectedStartBeat: clip.startBeat + applied,
                    },
                },
                redoAction: {
                    type: 'nudgeClip',
                    payload: {
                        clipId: alpha.payload.clipId,
                        beats: alpha.payload.beats,
                        expectedStartBeat: clip.startBeat,
                    },
                },
            };
        } catch {
            return { label, inverseAction: null };
        }
    },
    undoable: true,
});
