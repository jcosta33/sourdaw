import { createHandler } from '#/utils/createHandler';

import { trimClipStart } from '../../useCases/clipEditing/trimClipStart';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleTrimClipStart = createHandler<'trimClipStart'>({
    execute: (alpha) => {
        return toHandlerExecutionResult(
            trimClipStart(
                alpha.payload.clipId,
                alpha.payload.newStartBeat,
                alpha.payload.loopOriginBeat,
                alpha.payload.midiOffsetBeats
            )
        );
    },
    describe: (alpha) => {
        const label = 'Trim clip start';
        try {
            const state = getTrackStoreState();
            const clip = state?.tracks
                .flatMap((time) => time.clips)
                .find((context) => context.id === alpha.payload.clipId);
            if (!clip) {
                return { label, inverseAction: null };
            }

            const inversePayload: {
                clipId: string;
                newStartBeat: number;
                loopOriginBeat: number | null;
                midiOffsetBeats?: number;
            } = {
                clipId: clip.id,
                // The inverse records the pre-action anchor exactly (#5198): a
                // value puts it back, `null` records a clip that carried none —
                // so the undo of a leftward extension replays rightward and
                // stays anchorless instead of minting at the extension start.
                // Entries recorded before the field existed decode without it
                // and replay the mint law they always did.
                loopOriginBeat: clip.loopOriginBeat ?? null,
                newStartBeat: clip.startBeat,
            };
            if (clip.type === 'midi') {
                // The inverse also records the pre-action stored offset
                // (#5512): the replay must restore the figures the trim's wrap
                // displaced, not re-derive them against a duration the trim
                // moved. Keyed like the slip's `rowLiftBeats` — the replay
                // keys the verbatim restoration on the key's presence — and
                // midi-only, the only type whose trim re-bases offset and rows
                // through the wrap law.
                inversePayload.midiOffsetBeats = clip.midiOffsetBeats ?? 0;
            }
            return {
                label,
                inverseAction: {
                    type: 'trimClipStart',
                    payload: inversePayload,
                },
            };
        } catch {
            return { label, inverseAction: null };
        }
    },
    undoable: true,
});
