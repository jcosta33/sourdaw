import { createHandler } from '#/helpers/createHandler';
import { applyGrooveByGrooveId } from '../../useCases/grooveTemplate/applyGrooveByGrooveId';

export const handleApplyGroove = createHandler<'applyGroove'>({
    execute: (a) => {
        applyGrooveByGrooveId(a.payload.clipId, a.payload.grooveId, a.payload.amount ?? 1);
    },
    describe: (a) => ({ label: `Apply groove "${a.payload.grooveId}"` }),
    undoable: true,
});
