import { createHandler } from '#/utils/createHandler';
import { type TrackClipStateSnapshot } from '#/utils/handlerContract';

import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { captureTrackClipStates } from '../../useCases/captureTrackClipStates';
import { stripSilence } from '../../useCases/stripSilence';

type PendingStripSilenceSnapshot = {
    trackId: string;
    // See `handleCutClip`'s matching field for the describe-then-finalize
    // rationale: `execute()` fills this in place once the strip lands, and
    // the `describe()` result already references this same array.
    postStripState: TrackClipStateSnapshot[];
};

const pendingStripSilenceSnapshots = new WeakMap<object, PendingStripSilenceSnapshot>();

export const handleStripSilence = createHandler<'stripSilence'>({
    execute: (action) => {
        const didWrite = stripSilence(action.payload.clipId, action.payload.threshold, action.payload.minDuration);
        if (!didWrite) {
            return { status: 'no-write' };
        }

        const pending = pendingStripSilenceSnapshots.get(action);
        if (pending) {
            const settled = captureTrackClipStates([pending.trackId]);
            pending.postStripState.push(...settled);
        }

        return { status: 'written' };
    },
    describe: (action) => {
        // `resolveEligibleClipWriteTarget` runs the same eligibility gate
        // `stripSilence()` runs internally, before it has rewritten anything.
        const target = resolveEligibleClipWriteTarget({ clipId: action.payload.clipId });
        if (target.status !== 'eligible' || !('trackId' in target)) {
            return { label: 'Strip silence', inverseAction: null };
        }

        const preStripState = captureTrackClipStates([target.trackId]);
        const postStripState: TrackClipStateSnapshot[] = [];
        pendingStripSilenceSnapshots.set(action, { trackId: target.trackId, postStripState });

        return {
            label: 'Strip silence',
            inverseAction: {
                type: 'restoreTrackClipStates',
                payload: { expected: postStripState, replacement: preStripState },
            },
            redoAction: {
                type: 'restoreTrackClipStates',
                payload: { expected: preStripState, replacement: postStripState },
            },
        };
    },
    undoable: true,
});
