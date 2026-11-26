import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { type Clip } from '../../models/Track';
import { nudgeClip } from '../../useCases/clipEditing/nudgeClip';
import { planClipNudge } from '../../useCases/clipEditing/planClipNudge';
import { type ClipPlacement, readClipPlacement } from '../../useCases/clipEditing/readClipPlacement';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

import { readPlannedClip } from './readPlannedClip';

type NudgePayload = Extract<AppAction, { type: 'nudgeClip' }>['payload'];

function liveClip(clipId: string): Clip | undefined {
    return getTrackStoreState()
        ?.tracks.flatMap((track) => track.clips)
        .find((candidate) => candidate.id === clipId);
}

function hasExpectation(payload: NudgePayload): boolean {
    return payload.expectedPlacement !== undefined || payload.expectedStartBeat !== undefined;
}

/** Whether two placements hold the same beats; an absent anchor equals only an absent anchor. */
function isSamePlacement(a: ClipPlacement, b: ClipPlacement): boolean {
    return (
        a.startBeat === b.startBeat &&
        a.endBeat === b.endBeat &&
        a.loopOriginBeat === b.loopOriginBeat &&
        a.audioLoopPassOriginBeat === b.audioLoopPassOriginBeat
    );
}

/** Whether the clip is where a recorded leg expects it: the whole placement, else the start alone, else anywhere. */
function holdsExpectedPlacement(payload: NudgePayload, clip: Clip | undefined): boolean {
    if (payload.expectedPlacement !== undefined) {
        return clip !== undefined && isSamePlacement(readClipPlacement(clip), payload.expectedPlacement);
    }
    if (payload.expectedStartBeat !== undefined) {
        return clip?.startBeat === payload.expectedStartBeat;
    }
    return true;
}

export const handleNudgeClip = createHandler<'nudgeClip'>({
    canReapplyAfterDivergence: (alpha) => hasExpectation(alpha.payload),
    validate: (alpha, context) => holdsExpectedPlacement(alpha.payload, readPlannedClip(alpha.payload.clipId, context)),
    execute: (alpha) => {
        // An unguarded nudge never reads the live clip here; the writer owns its own malformed-state refusal.
        if (hasExpectation(alpha.payload) && !holdsExpectedPlacement(alpha.payload, liveClip(alpha.payload.clipId))) {
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
                        expectedPlacement: after,
                        placement: before,
                    },
                },
                redoAction: {
                    type: 'nudgeClip',
                    payload: {
                        clipId: alpha.payload.clipId,
                        beats: alpha.payload.beats,
                        expectedPlacement: before,
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
