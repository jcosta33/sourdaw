import { createHandler } from '#/utils/createHandler';

import { type AutomationPoint } from '../../models/Automation';
import { restoreAutomationLanePoints } from '../../useCases/automation/restoreAutomationLanePoints';

/**
 * Inverse-action handler for the automation transform handlers
 * (reverse/scale/stretch/thin/quantize/invert). Replays the lane-points snapshot
 * carried in the action payload — does not compute state itself.
 *
 * `undoable: false` — invoked only by undo machinery; must not create new undo entries.
 */
export const handleRestoreAutomationLanePoints = createHandler<'restoreAutomationLanePoints'>({
    execute: (action) => {
        // The payload carries the structural `AutomationPointSnapshot` shape (Command
        // cannot import Automation's model). It is the exact runtime shape of an
        // `AutomationPoint`, captured by the emitting handler's `describe()`.
        restoreAutomationLanePoints(action.payload.laneId, action.payload.points as AutomationPoint[]);
    },
    describe: () => ({ label: 'Restore automation points' }),
    undoable: false,
});
