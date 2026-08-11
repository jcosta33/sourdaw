import { createAutomationLane } from '../../models/Automation';
import { resolveAutomationParameterRange } from '../../services/automationParameterRangeResolver';
import { automationStore } from '../../stores/automationStore';

export function addAutomationLane(trackId: string, parameterId: string, parameterName: string, laneId?: string): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }

    const exists = state.lanes.some(
        (lane) => lane.id === laneId || (!lane.clipId && lane.trackId === trackId && lane.parameterId === parameterId)
    );
    if (exists) {
        return;
    }

    let parameterRange = null;
    if (parameterId !== 'gain' && parameterId !== 'pan') {
        parameterRange = resolveAutomationParameterRange({ trackId, parameterTargetId: parameterId });
    }
    const minValue = parameterRange?.minValue ?? (parameterId === 'pan' ? -1 : 0);
    const maxValue = parameterRange?.maxValue ?? 1;
    const lane = createAutomationLane(trackId, parameterId, parameterName, minValue, maxValue);
    automationStore.set({
        lanes: [...state.lanes, laneId === undefined ? lane : { ...lane, id: laneId }],
    });
}
