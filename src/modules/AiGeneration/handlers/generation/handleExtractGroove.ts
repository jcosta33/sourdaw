import { createHandler } from '#/utils/createHandler';

import { extractGroove } from '../../useCases/grooveTemplate/operations/extractGroove';
import { registerExtractedGroove } from '../../useCases/grooveTemplate/registerExtractedGroove';

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
