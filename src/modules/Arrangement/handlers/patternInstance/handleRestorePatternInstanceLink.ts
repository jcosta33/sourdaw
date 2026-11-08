import { createHandler } from '#/utils/createHandler';

import { isPatternInstanceLinkCurrent } from '../../useCases/patternInstance/isPatternInstanceLinkCurrent';
import { restorePatternInstanceLink } from '../../useCases/patternInstance/restorePatternInstanceLink';

export const handleRestorePatternInstanceLink = createHandler<'restorePatternInstanceLink'>({
    batchExecution: 'singleton',
    execute: (action) => ({ status: restorePatternInstanceLink(action.payload) }),
    validate: (action) => isPatternInstanceLinkCurrent(action.payload),
    canReapplyAfterDivergence: (action) => isPatternInstanceLinkCurrent(action.payload),
    describe: () => ({ label: 'Restore pattern instance link' }),
    undoable: false,
});
