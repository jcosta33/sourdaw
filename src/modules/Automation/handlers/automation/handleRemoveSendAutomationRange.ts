import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { type AutomationLane, type AutomationPoint } from '../../models/Automation';
import { buildSendAutomationRangeLane } from '../../services/buildSendAutomationRangeLane';
import { removeSendAutomationRange } from '../../useCases/automation/removeSendAutomationRange';
import { getAutomationStoreState } from '../../useCases/getAutomationStoreState';

type RemoveSendAutomationRangeAction = Extract<AppAction, { type: 'removeSendAutomationRange' }>;

function pointsMatch(actual: readonly AutomationPoint[], expected: readonly AutomationPoint[]): boolean {
    return (
        actual.length === expected.length &&
        actual.every((point, index) => {
            const expectedPoint = expected[index];
            if (!expectedPoint) {
                return false;
            }
            return (
                point.id === expectedPoint.id &&
                point.beat === expectedPoint.beat &&
                point.value === expectedPoint.value &&
                point.curve === expectedPoint.curve &&
                point.tension === expectedPoint.tension &&
                point.stairSteps === expectedPoint.stairSteps &&
                point.cp1?.x === expectedPoint.cp1?.x &&
                point.cp1?.y === expectedPoint.cp1?.y &&
                point.cp2?.x === expectedPoint.cp2?.x &&
                point.cp2?.y === expectedPoint.cp2?.y
            );
        })
    );
}

function laneMatches(actual: AutomationLane, expected: AutomationLane): boolean {
    return (
        actual.id === expected.id &&
        actual.trackId === expected.trackId &&
        actual.clipId === expected.clipId &&
        actual.clipAutomationMode === expected.clipAutomationMode &&
        actual.parameterId === expected.parameterId &&
        actual.parameterName === expected.parameterName &&
        pointsMatch(actual.points, expected.points) &&
        actual.trimPoints === expected.trimPoints &&
        actual.objects.length === 0 &&
        actual.ghostPoints === expected.ghostPoints &&
        actual.visible === expected.visible &&
        actual.enabled === expected.enabled &&
        actual.collapsed === expected.collapsed &&
        actual.linkedLaneId === expected.linkedLaneId &&
        actual.linkScale === expected.linkScale &&
        actual.minValue === expected.minValue &&
        actual.maxValue === expected.maxValue &&
        actual.viewMinValue === expected.viewMinValue &&
        actual.viewMaxValue === expected.viewMaxValue &&
        actual.color === expected.color
    );
}

function lanesMatch(action: RemoveSendAutomationRangeAction): boolean {
    const state = getAutomationStoreState();
    if (!state || action.payload.trackIds.length !== action.payload.expectedSends.length) {
        return false;
    }
    return action.payload.expectedSends.every((send) => {
        const expected = buildSendAutomationRangeLane({
            trackId: send.trackId,
            busId: action.payload.busId,
            busName: action.payload.busName,
            baseLevel: send.level,
            startBeat: action.payload.startBeat,
            endBeat: action.payload.endBeat,
            reductionDb: action.payload.reductionDb,
        });
        const actual = state.lanes.find((lane) => lane.id === expected.id);
        return actual !== undefined && laneMatches(actual, expected);
    });
}

export const handleRemoveSendAutomationRange = createHandler<'removeSendAutomationRange'>({
    canReapplyAfterDivergence: () => true,
    validate: (action) => lanesMatch(action),
    execute: (action) => {
        if (!lanesMatch(action)) {
            return { status: 'conflict' };
        }
        const laneIds = action.payload.expectedSends.map(
            (send) => `auto-send-${encodeURIComponent(send.trackId)}-${encodeURIComponent(action.payload.busId)}`
        );
        return removeSendAutomationRange(laneIds) ? { status: 'written' } : { status: 'conflict' };
    },
    describe: (action) => ({
        label: `Restore sends outside ${action.payload.sectionName}`,
        inverseAction: lanesMatch(action) ? { type: 'automateSendRange', payload: action.payload } : null,
    }),
    undoable: true,
});
