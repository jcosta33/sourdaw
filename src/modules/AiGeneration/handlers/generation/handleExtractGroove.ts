import { createHandler } from '#/utils/createHandler';

import { extractGroove } from '../../useCases/grooveTemplate/operations/extractGroove';

export const handleExtractGroove = createHandler<'extractGroove'>({
    execute: (a) => {
        extractGroove(a.payload.clipId);
    },
    describe: () => ({ label: 'Extract groove template' }),
    undoable: false,
});
