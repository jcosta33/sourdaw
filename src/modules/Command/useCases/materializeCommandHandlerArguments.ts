import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

/**
 * Canonical command arguments are handler-owned. Clone only when a handler
 * supplies that canonicalization hook so callers retain their planned action.
 */
export function materializeCommandHandlerArguments<Action extends AppAction>(
    action: Action,
    handler: Pick<ActionHandler<Action>, 'materializeCommandArguments'>
): Action {
    if (!handler.materializeCommandArguments) {
        return action;
    }
    const canonicalAction = structuredClone(action);
    handler.materializeCommandArguments(canonicalAction);
    return canonicalAction;
}
