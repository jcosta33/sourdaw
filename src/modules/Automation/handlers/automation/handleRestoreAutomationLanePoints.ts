import { createHandler } from '#/utils/createHandler';
import { type AutomationPointSnapshot } from '#/utils/handlerContract';

import { type AutomationPoint } from '../../models/Automation';
import { restoreAutomationLanePoints } from '../../useCases/automation/restoreAutomationLanePoints';
import { getAutomationStoreState } from '../../useCases/getAutomationStoreState';

import { automationPointSnapshotsMatch as pointsMatch } from './automationPointSnapshotsMatch';
import {
    isRestorableAutomationPointSet as isRestorablePointSet,
    isRestoreAutomationLanePointsPayload,
} from './validateRangeWriteSessionEntries';

type RestorePayload = {
    laneId: string;
    points: readonly AutomationPointSnapshot[];
    expectedPoints?: readonly AutomationPointSnapshot[];
};

function isRestorablePayload(payload: RestorePayload): payload is RestorePayload & { points: AutomationPoint[] } {
    return (
        typeof payload.laneId === 'string' &&
        payload.laneId.length > 0 &&
        isRestorablePointSet(payload.points) &&
        (!Object.hasOwn(payload, 'expectedPoints') ||
            (payload.expectedPoints !== undefined && isRestorablePointSet(payload.expectedPoints)))
    );
}

export const handleRestoreAutomationLanePoints = createHandler<'restoreAutomationLanePoints'>({
    validate: (action) => isRestorablePayload(action.payload),
    execute: (action) => {
        const lane = getAutomationStoreState()?.lanes.find((candidate) => candidate.id === action.payload.laneId);
        if (!isRestorablePayload(action.payload)) {
            return { status: 'conflict' };
        }
        if (action.payload.expectedPoints && (!lane || !pointsMatch(lane.points, action.payload.expectedPoints))) {
            return { status: 'conflict' };
        }
        if (!lane) {
            return { status: 'no-write' };
        }
        restoreAutomationLanePoints(action.payload.laneId, action.payload.points);
        return { status: 'written' };
    },
    isNoop: (action) => {
        if (!isRestorablePayload(action.payload)) {
            return false;
        }
        const lane = getAutomationStoreState()?.lanes.find((candidate) => candidate.id === action.payload.laneId);
        if (action.payload.expectedPoints && (!lane || !pointsMatch(lane.points, action.payload.expectedPoints))) {
            return false;
        }
        return !lane || pointsMatch(lane.points, action.payload.points);
    },
    // The restore writes only while the lane still holds exactly the points it expects, so an
    // inverse that names them can be reapplied inside an atomic batch without overwriting an edit.
    canReapplyAfterDivergence: (action) =>
        isRestorablePayload(action.payload) && Object.hasOwn(action.payload, 'expectedPoints'),
    describe: () => ({ label: 'Restore automation points' }),
    validateSessionActionArguments: isRestoreAutomationLanePointsPayload,
    canReportConflict: true,
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: false,
});
