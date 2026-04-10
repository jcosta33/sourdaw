import { createHandler } from '#/helpers/createHandler';
import { extractGroove } from '../../useCases/grooveTemplate/operations';

export const handleExtractGroove = createHandler<'extractGroove'>({
    execute: (a) => {
        extractGroove(a.payload.clipId);
    },
    describe: () => ({ label: 'Extract groove template' }),
    undoable: false,
});
