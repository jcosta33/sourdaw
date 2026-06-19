import { createHandler } from '#/utils/createHandler';

import { registerExtractedGroove } from '../../useCases/grooveTemplate/applyGrooveByGrooveId';
import { extractGroove } from '../../useCases/grooveTemplate/operations/extractGroove';

export const handleExtractGroove = createHandler<'extractGroove'>({
    execute: (alpha) => {
        // Persist the extracted template so `applyGroove` with the synthetic
        // `extracted-<clipId>` id can find it later; previously the return was
        // discarded, making this action a no-op.
        const template = extractGroove(alpha.payload.clipId);
        registerExtractedGroove(template);
    },
    describe: () => ({ label: 'Extract groove template' }),
    undoable: false,
});
