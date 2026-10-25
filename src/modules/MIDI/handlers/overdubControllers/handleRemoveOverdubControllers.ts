import { createHandler } from '#/utils/createHandler';

import { isOverdubControllerIdsPayload } from '../../transformers/isOverdubControllerIdsPayload';
import { removeRecordedMidiControllers } from '../../useCases/recordedControllerTake/removeRecordedMidiControllers';

/**
 * Inverse of `appendOverdubControllers`: take the rows the pass added out by id.
 * A row already gone, or an edit a peer made to another row, is not this
 * handler's concern, so Undo never rewrites the clip's list around them.
 */
export const handleRemoveOverdubControllers = createHandler<'removeOverdubControllers'>({
    validate: (action) => isOverdubControllerIdsPayload(action.payload),
    execute: (action) => ({
        status: removeRecordedMidiControllers(action.payload.clips) ? 'written' : 'no-write',
    }),
    describe: () => ({ label: 'Remove overdub controllers' }),
    undoable: false,
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
});
