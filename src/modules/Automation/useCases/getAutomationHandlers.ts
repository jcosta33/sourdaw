import { type ActionHandler, type AppAction } from '#/modules/Command/useCases/commandQueries';

import { handleAddAutomationLane } from '../handlers/automation/handleAddAutomationLane';
import { handleAddAutomationPoint } from '../handlers/automation/handleAddAutomationPoint';
import { handleInvertAutomation } from '../handlers/automation/handleInvertAutomation';
import { handleQuantizeAutomation } from '../handlers/automation/handleQuantizeAutomation';
import { handleRemoveAutomationPoint } from '../handlers/automation/handleRemoveAutomationPoint';
import { handleReverseAutomation } from '../handlers/automation/handleReverseAutomation';
import { handleScaleAutomation } from '../handlers/automation/handleScaleAutomation';
import { handleStretchAutomation } from '../handlers/automation/handleStretchAutomation';
import { handleThinAutomation } from '../handlers/automation/handleThinAutomation';

type AutomationAction =
    | Extract<AppAction, { type: 'addAutomationLane' }>
    | Extract<AppAction, { type: 'addAutomationPoint' }>
    | Extract<AppAction, { type: 'removeAutomationPoint' }>
    | Extract<AppAction, { type: 'scaleAutomation' }>
    | Extract<AppAction, { type: 'stretchAutomation' }>
    | Extract<AppAction, { type: 'invertAutomation' }>
    | Extract<AppAction, { type: 'reverseAutomation' }>
    | Extract<AppAction, { type: 'thinAutomation' }>
    | Extract<AppAction, { type: 'quantizeAutomation' }>;

export type AutomationHandlersMap = {
    [Action in AutomationAction as Action['type']]: ActionHandler<Action>;
};

/**
 * Merges Automation `ActionHandler` maps for Command. Does **not** call `createHandler` here.
 */
export function getAutomationHandlers(): AutomationHandlersMap {
    return {
        addAutomationLane: handleAddAutomationLane,
        addAutomationPoint: handleAddAutomationPoint,
        removeAutomationPoint: handleRemoveAutomationPoint,
        scaleAutomation: handleScaleAutomation,
        stretchAutomation: handleStretchAutomation,
        invertAutomation: handleInvertAutomation,
        reverseAutomation: handleReverseAutomation,
        thinAutomation: handleThinAutomation,
        quantizeAutomation: handleQuantizeAutomation,
    };
}
