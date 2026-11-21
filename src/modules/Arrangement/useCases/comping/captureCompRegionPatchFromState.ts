import {
    captureCompSelection,
    type TakeLaneCompRegionPatch,
    type TakeLaneStoreValue,
} from '../../stores/takeLaneWriteJournal';
import { liveTempoTimeline } from '../liveTempoTimeline';

import { compRegionIntervalValidation } from './compRegionIntervalValidation';
import { sourceInputsAfterPrefix } from './compSourcePlan';
import { prepareCompAudioSourcePatch } from './prepareCompAudioSourcePatch';

const { isValidInterval } = compRegionIntervalValidation;

export type CompRegionInput = {
    readonly trackId: string;
    readonly startBeat: number;
    readonly endBeat: number;
    readonly takeId: string;
};

function captureCompRegionIntervalPatchFromState(
    state: TakeLaneStoreValue,
    input: CompRegionInput,
    sourcePlan = sourceInputsAfterPrefix(input.trackId)
): TakeLaneCompRegionPatch | null {
    if (!sourcePlan || !isValidInterval(input.startBeat, input.endBeat)) {
        return null;
    }
    const matches = state.lanes.filter((lane) => lane.trackId === input.trackId);
    const lane = matches.length === 1 ? matches[0] : undefined;
    if (!lane || !lane.takes.some((take) => take.id === input.takeId)) {
        return null;
    }
    return prepareCompAudioSourcePatch(
        state,
        {
            laneId: lane.id,
            trackId: input.trackId,
            startBeat: input.startBeat,
            endBeat: input.endBeat,
            expected: captureCompSelection(lane.activeCompRegions, input.startBeat, input.endBeat),
            replacement: [{ startBeat: input.startBeat, endBeat: input.endBeat, takeId: input.takeId }],
        },
        sourcePlan.clips,
        liveTempoTimeline,
        sourcePlan.inputs
    );
}

function captureRemovedCompRegionPatchFromState(
    state: TakeLaneStoreValue,
    input: { readonly trackId: string; readonly startBeat: number },
    sourcePlan = sourceInputsAfterPrefix(input.trackId)
): TakeLaneCompRegionPatch | null {
    if (!sourcePlan || !Number.isFinite(input.startBeat) || input.startBeat < 0) {
        return null;
    }
    const lanes = state.lanes.filter((lane) => lane.trackId === input.trackId);
    const lane = lanes.length === 1 ? lanes[0] : undefined;
    const region = lane?.activeCompRegions.find((candidate) => candidate.startBeat === input.startBeat);
    if (!lane || !region || !lane.takes.some((take) => take.id === region.takeId)) {
        return null;
    }
    return prepareCompAudioSourcePatch(
        state,
        {
            laneId: lane.id,
            trackId: lane.trackId,
            startBeat: region.startBeat,
            endBeat: region.endBeat,
            expected: captureCompSelection(lane.activeCompRegions, region.startBeat, region.endBeat),
            replacement: [],
        },
        sourcePlan.clips,
        liveTempoTimeline,
        sourcePlan.inputs
    );
}

export const compRegionPatchFromState = {
    captureCompRegionIntervalPatchFromState,
    captureRemovedCompRegionPatchFromState,
};
