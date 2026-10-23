import { createHandler } from '#/utils/createHandler';

import { isOverdubControllerRowsPayload } from '../../transformers/isOverdubControllerRowsPayload';
import { appendRecordedMidiControllers } from '../../useCases/recordedControllerTake/appendRecordedMidiControllers';
import { readOverdubRowsToAppend } from '../../useCases/recordedControllerTake/readOverdubRowsToAppend';

/**
 * Land one overdub pass's controller and pitch-bend rows as a single history
 * entry. The rows come in the payload with the ids they keep, so Redo replays
 * this action unchanged and the inverse removes exactly the rows `execute` wrote
 * (`readOverdubRowsToAppend` is the one reading of what that is).
 */
export const handleAppendOverdubControllers = createHandler<'appendOverdubControllers'>({
    validate: (action) => isOverdubControllerRowsPayload(action.payload),
    execute: (action) => {
        const toAppend = readOverdubRowsToAppend(action.payload.clips);
        for (const clip of toAppend) {
            appendRecordedMidiControllers(clip);
        }
        return { status: toAppend.length > 0 ? 'written' : 'no-write' };
    },
    describe: (action) => {
        const label = 'Record overdub controllers';
        const toAppend = readOverdubRowsToAppend(action.payload.clips);
        if (toAppend.length === 0) {
            return { label, inverseAction: null };
        }
        return {
            label,
            inverseAction: {
                type: 'removeOverdubControllers',
                payload: {
                    clips: toAppend.map((clip) => ({
                        clipId: clip.clipId,
                        ccIds: clip.cc.map((row) => row.id),
                        pitchBendIds: clip.pitchBend.map((row) => row.id),
                    })),
                },
            },
        };
    },
    undoable: true,
    isNoop: (action) => action.payload.clips.every((clip) => clip.cc.length === 0 && clip.pitchBend.length === 0),
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
});
