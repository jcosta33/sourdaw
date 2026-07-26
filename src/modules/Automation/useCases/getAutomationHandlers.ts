import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { handleAddAutomationLane } from '../handlers/automation/handleAddAutomationLane';
import { handleAddAutomationPoint } from '../handlers/automation/handleAddAutomationPoint';
import { handleInvertAutomation } from '../handlers/automation/handleInvertAutomation';
import { handleQuantizeAutomation } from '../handlers/automation/handleQuantizeAutomation';
import { handleRemoveAutomationLane } from '../handlers/automation/handleRemoveAutomationLane';
import { handleRemoveAutomationPoint } from '../handlers/automation/handleRemoveAutomationPoint';
import { handleRestoreAutomationLanePoints } from '../handlers/automation/handleRestoreAutomationLanePoints';
import { handleReverseAutomation } from '../handlers/automation/handleReverseAutomation';
import { handleScaleAutomation } from '../handlers/automation/handleScaleAutomation';
import { handleSetAutomationLaneEnabled } from '../handlers/automation/handleSetAutomationLaneEnabled';
import { handleStretchAutomation } from '../handlers/automation/handleStretchAutomation';
import { handleThinAutomation } from '../handlers/automation/handleThinAutomation';

type AutomationAction =
    | Extract<AppAction, { type: 'addAutomationLane' }>
    | Extract<AppAction, { type: 'removeAutomationLane' }>
    | Extract<AppAction, { type: 'setAutomationLaneEnabled' }>
    | Extract<AppAction, { type: 'addAutomationPoint' }>
    | Extract<AppAction, { type: 'removeAutomationPoint' }>
    | Extract<AppAction, { type: 'scaleAutomation' }>
    | Extract<AppAction, { type: 'stretchAutomation' }>
    | Extract<AppAction, { type: 'invertAutomation' }>
    | Extract<AppAction, { type: 'reverseAutomation' }>
    | Extract<AppAction, { type: 'thinAutomation' }>
    | Extract<AppAction, { type: 'quantizeAutomation' }>
    | Extract<AppAction, { type: 'restoreAutomationLanePoints' }>;

export type AutomationHandlersMap = {
    [Action in AutomationAction as Action['type']]: ActionHandler<Action>;
};

/**
 * Merges Automation `ActionHandler` maps for Command. Does **not** call `createHandler` here.
 */
export function getAutomationHandlers(): AutomationHandlersMap {
    return {
        addAutomationLane: handleAddAutomationLane,
        removeAutomationLane: handleRemoveAutomationLane,
        setAutomationLaneEnabled: handleSetAutomationLaneEnabled,
        addAutomationPoint: handleAddAutomationPoint,
        removeAutomationPoint: handleRemoveAutomationPoint,
        scaleAutomation: handleScaleAutomation,
        stretchAutomation: handleStretchAutomation,
        invertAutomation: handleInvertAutomation,
        reverseAutomation: handleReverseAutomation,
        thinAutomation: handleThinAutomation,
        quantizeAutomation: handleQuantizeAutomation,
        restoreAutomationLanePoints: handleRestoreAutomationLanePoints,
    };
}
