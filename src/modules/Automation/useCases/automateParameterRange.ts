import { createAutomationLane } from '../models/Automation';
import { automationStore } from '../stores/automationStore';

import { planParameterRangeWrite, type ParameterRangeWriteResult } from './automation/planParameterRangeWrite';

type AutomateParameterRangeInput = Parameters<typeof planParameterRangeWrite>[0];

/**
 * Holds one track parameter at a target across a musical range: plans the write against the live
 * project and lands it on the parameter's track lane, creating that lane when the track does not
 * automate the parameter yet. A refused plan writes nothing and says why.
 */
export function automateParameterRange(input: AutomateParameterRangeInput): ParameterRangeWriteResult {
    const state = automationStore.value;
    if (!state) {
        return { status: 'refused', refusal: 'unknown-track', reason: 'No project is open to automate.' };
    }
    const plan = planParameterRangeWrite(input);
    if (plan.status !== 'planned') {
        return plan;
    }
    const points = plan.pointsAfter;
    if (plan.creation === null) {
        automationStore.set({
            lanes: state.lanes.map((lane) => (lane.id === plan.laneId ? { ...lane, points } : lane)),
        });
        return plan;
    }
    const { trackId, parameterId, parameterName, minValue, maxValue } = plan.creation;
    const lane = createAutomationLane(trackId, parameterId, parameterName, minValue, maxValue);
    automationStore.set({ lanes: [...state.lanes, { ...lane, id: plan.laneId, points }] });
    return plan;
}
