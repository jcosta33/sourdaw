import { createHandler } from '#/utils/createHandler';

import { applyGrooveByGrooveId } from '../../useCases/grooveTemplate/applyGrooveByGrooveId';

export const handleApplyGroove = createHandler<'applyGroove'>({
    execute: (alpha) => {
        applyGrooveByGrooveId(alpha.payload.clipId, alpha.payload.grooveId, alpha.payload.amount ?? 1);
    },
    describe: (alpha) => ({ label: `Apply groove "${alpha.payload.grooveId}"` }),
    undoable: true,
});
