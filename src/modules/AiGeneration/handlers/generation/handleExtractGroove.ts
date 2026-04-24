import { createHandler } from '#/utils/createHandler';

import { extractGroove } from '../../useCases/grooveTemplate/operations/extractGroove';

export const handleExtractGroove = createHandler<'extractGroove'>({
    execute: (alpha) => {
        extractGroove(alpha.payload.clipId);
    },
    describe: () => ({ label: 'Extract groove template' }),
    undoable: false,
});
