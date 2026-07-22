import { automationStore, type AutomationStoreState } from '../../stores/automationStore';

type PrepareClipAutomationShiftTransactionInput = {
    clipId: string;
    beatDelta: number;
};

type TransactionPhase = 'prepared' | 'applied' | 'closed';

type ShiftedAutomationState = {
    hasChanges: boolean;
    nextState: AutomationStoreState | null;
};

function prepareShiftedState(
    preparedState: AutomationStoreState | null,
    clipId: string,
    beatDelta: number
): ShiftedAutomationState {
    if (!preparedState || !Number.isFinite(beatDelta)) {
        return {
            hasChanges: false,
            nextState: preparedState,
        };
    }

    const lanes = preparedState.lanes.map((lane) => {
        if (lane.clipId !== clipId) {
            return lane;
        }

        const points = lane.points
            .map((automationPoint) => ({
                ...automationPoint,
                beat: Math.max(0, automationPoint.beat + beatDelta),
            }))
            .sort((leftPoint, rightPoint) => leftPoint.beat - rightPoint.beat);
        const laneHasChanges = points.some((automationPoint, index) => {
            return automationPoint.beat !== lane.points[index]!.beat;
        });
        if (!laneHasChanges) {
            return lane;
        }

        return {
            ...lane,
            points,
        };
    });
    const hasChanges = lanes.some((lane, index) => lane !== preparedState.lanes[index]);

    if (!hasChanges) {
        return {
            hasChanges: false,
            nextState: preparedState,
        };
    }

    return {
        hasChanges: true,
        nextState: { lanes },
    };
}

export function prepareClipAutomationShiftTransaction({
    clipId,
    beatDelta,
}: PrepareClipAutomationShiftTransactionInput) {
    const preparedState = automationStore.value;
    const shiftedState = prepareShiftedState(preparedState, clipId, beatDelta);
    let phase: TransactionPhase = 'prepared';

    function apply(): boolean {
        if (phase !== 'prepared') {
            return false;
        }
        if (!shiftedState.hasChanges || !shiftedState.nextState) {
            phase = 'closed';
            return false;
        }
        if (automationStore.value !== preparedState) {
            phase = 'closed';
            return false;
        }

        phase = 'closed';
        automationStore.set(shiftedState.nextState);
        if (automationStore.value !== shiftedState.nextState) {
            return false;
        }

        phase = 'applied';
        return true;
    }

    function revert(): boolean {
        if (phase !== 'applied') {
            return false;
        }
        if (!preparedState || !shiftedState.nextState) {
            phase = 'closed';
            return false;
        }
        if (automationStore.value !== shiftedState.nextState) {
            phase = 'closed';
            return false;
        }

        phase = 'closed';
        automationStore.set(preparedState);
        return automationStore.value === preparedState;
    }

    return {
        hasChanges: shiftedState.hasChanges,
        apply,
        revert,
    };
}
