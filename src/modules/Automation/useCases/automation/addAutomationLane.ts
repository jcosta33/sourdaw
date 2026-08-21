import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';

import { createAutomationLane } from '../../models/Automation';
import { automationStore } from '../../stores/automationStore';

import { getAutomationParameterRangeResolver } from './getAutomationParameterRangeResolver';

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
        const resolveParameterRange = getAutomationParameterRangeResolver();
        parameterRange = resolveParameterRange?.({ trackId, parameterTargetId: parameterId }) ?? null;
    }
    const minValue = parameterRange?.minValue ?? (parameterId === 'pan' ? -1 : 0);
    const maxValue = parameterRange?.maxValue ?? (parameterId === 'gain' ? FADER_MAX_GAIN : 1);
    const lane = createAutomationLane(trackId, parameterId, parameterName, minValue, maxValue);
    automationStore.set({
        lanes: [...state.lanes, laneId === undefined ? lane : { ...lane, id: laneId }],
    });
}
