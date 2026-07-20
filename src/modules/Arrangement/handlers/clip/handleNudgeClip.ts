import { createHandler } from '#/utils/createHandler';

import { nudgeClip } from '../../useCases/clipEditing/nudgeClip';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';

export const handleNudgeClip = createHandler<'nudgeClip'>({
    execute: (alpha) => {
        nudgeClip(alpha.payload.clipId, alpha.payload.beats);
    },
    describe: (alpha) => {
        const label = `Nudge clip ${alpha.payload.beats > 0 ? 'right' : 'left'}`;
        const state = getTrackStoreState();
        const clip = state?.tracks.flatMap((time) => time.clips).find((context) => context.id === alpha.payload.clipId);
        if (!clip) {
            return { label, inverseAction: null };
        }
        // The forward nudge clamps at beat 0 and shifts MIDI notes/automation by
        // the applied delta, so the inverse must negate the applied post-clamp
        // delta — not the requested one — or undo/redo drift the notes off the
        // clip rectangle.
        const applied = Math.max(0, clip.startBeat + alpha.payload.beats) - clip.startBeat;
        return {
            label,
            inverseAction: { type: 'nudgeClip', payload: { clipId: alpha.payload.clipId, beats: -applied } },
        };
    },
    undoable: true,
});
