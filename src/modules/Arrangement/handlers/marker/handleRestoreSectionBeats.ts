import { createHandler } from '#/utils/createHandler';

import { restoreSectionBeats } from '../../useCases/marker/sectionOperations/restoreSectionBeats';

/**
 * Guarded inverse of `reorderSection`: restores BOTH swapped sections' exact
 * pre-reorder beat spans, the gap between them included. Emitted only by the
 * reorder handler's `describe()` — never invoked directly.
 */
export const handleRestoreSectionBeats = createHandler<'restoreSectionBeats'>({
    execute: (action) => {
        restoreSectionBeats(action.payload.sections);
        return { status: 'written' };
    },
    describe: () => ({ label: 'Restore section beats' }),
    undoable: false,
});
