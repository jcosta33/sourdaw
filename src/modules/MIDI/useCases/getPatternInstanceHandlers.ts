import { type ActionHandler, type AppAction } from '#/modules/Command/useCases/commandQueries';

import { handleCreatePatternInstance } from '../handlers/patternInstance/handleCreatePatternInstance';
import { handleDetachPatternInstance } from '../handlers/patternInstance/handleDetachPatternInstance';

type PatternInstanceAppAction =
    | Extract<AppAction, { type: 'createPatternInstance' }>
    | Extract<AppAction, { type: 'detachPatternInstance' }>;

export type PatternInstanceHandlersMap = {
    [Action in PatternInstanceAppAction as Action['type']]: ActionHandler<Action>;
};

/**
 * Merges pattern-instance `ActionHandler` maps for Command. Does **not** call `createHandler` here.
 */
export function getPatternInstanceHandlers(): PatternInstanceHandlersMap {
    return {
        createPatternInstance: handleCreatePatternInstance,
        detachPatternInstance: handleDetachPatternInstance,
    };
}
