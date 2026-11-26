import { createHandler } from '#/utils/createHandler';
import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';

import { isPatternInstanceLinkCurrent } from '../../useCases/patternInstance/isPatternInstanceLinkCurrent';
import { restorePatternInstanceLink } from '../../useCases/patternInstance/restorePatternInstanceLink';

type RestoreAction = Extract<AppAction, { type: 'restorePatternInstanceLink' }>;

/**
 * A restore replayed right after the detach it inverts, as a compensation inside one batch is, finds the
 * clip still linked: the detach has not run yet. The link it expects is then the one the detach found,
 * which the restore captured as its replacement.
 */
function followsItsDetach(action: RestoreAction, context: HandlerValidationContext | undefined): boolean {
    const previous = context?.actions[context.actionIndex - 1];
    return previous?.type === 'detachPatternInstance' && previous.payload.clipId === action.payload.clipId;
}

function isReadyToRestore(action: RestoreAction, context?: HandlerValidationContext): boolean {
    if (followsItsDetach(action, context)) {
        return isPatternInstanceLinkCurrent({ ...action.payload, expected: action.payload.replacement });
    }
    return isPatternInstanceLinkCurrent(action.payload);
}

export const handleRestorePatternInstanceLink = createHandler<'restorePatternInstanceLink'>({
    batchExecution: 'singleton',
    execute: (action) => ({ status: restorePatternInstanceLink(action.payload) }),
    validate: (action, context) => isReadyToRestore(action, context),
    canReapplyAfterDivergence: (action, context) => isReadyToRestore(action, context),
    describe: () => ({ label: 'Restore pattern instance link' }),
    undoable: false,
});
