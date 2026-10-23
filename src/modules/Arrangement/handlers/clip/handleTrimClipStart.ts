import { createHandler } from '#/utils/createHandler';

import { trimClipStart } from '../../useCases/clipEditing/trimClipStart';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleTrimClipStart = createHandler<'trimClipStart'>({
    execute: (alpha) => {
        return toHandlerExecutionResult(
            trimClipStart(alpha.payload.clipId, alpha.payload.newStartBeat, alpha.payload.loopOriginBeat)
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

            return {
                label,
                // The inverse records the pre-action anchor exactly (#5198): a
                // value puts it back, `null` records a clip that carried none —
                // so the undo of a leftward extension replays rightward and
                // stays anchorless instead of minting at the extension start.
                // Entries recorded before the field existed decode without it
                // and replay the mint law they always did.
                inverseAction: {
                    type: 'trimClipStart',
                    payload: {
                        clipId: clip.id,
                        loopOriginBeat: clip.loopOriginBeat ?? null,
                        newStartBeat: clip.startBeat,
                    },
                },
            };
        } catch {
            return { label, inverseAction: null };
        }
    },
    undoable: true,
});
