import { type HandlerValidationContext } from '#/utils/handlerContract';

import { createTrack, type Track } from '../models/Track';
import { getTrackStoreState } from '../useCases/getTrackStoreState';

import { projectTrackThroughPriorBatchActions } from './projectTrackThroughPriorBatchActions';

function createPlannedTrack(input: {
    id: string;
    name: string;
    kind: 'audio' | 'midi' | 'bus' | 'folder';
    gain: number;
    initialDeviceId?: string;
    parentId?: string;
    outputId?: string;
    withoutDefaultDevice?: boolean;
}): Track {
    const alternativeId = `planned-alternative-${input.id}`;
    return createTrack({
        id: input.id,
        name: input.name,
        kind: input.kind,
        gain: input.gain,
        color: '#000000',
        initialAlternativeId: alternativeId,
        initialDeviceId: input.initialDeviceId,
        parentId: input.parentId,
        outputId: input.outputId,
        withoutDefaultDevice: input.withoutDefaultDevice,
    });
}

export function getPlannedTrackState(context: HandlerValidationContext, trackId: string): Track | null {
    const current = getTrackStoreState()?.tracks.find((track) => track.id === trackId);
    if (current) {
        return projectTrackThroughPriorBatchActions(current, context);
    }
    for (const action of context.actions.slice(0, context.actionIndex)) {
        if (action.type === 'addTrack' && action.payload.id === trackId && action.payload.kind !== 'master') {
            return projectTrackThroughPriorBatchActions(
                createPlannedTrack({
                    id: trackId,
                    name: action.payload.name,
                    kind: action.payload.kind,
                    gain: 0.8,
                    initialDeviceId: action.payload.initialDeviceId,
                    parentId: action.payload.parentId,
                    outputId: action.payload.outputId,
                    withoutDefaultDevice: action.payload.withoutDefaultDevice,
                }),
                context
            );
        }
        if (action.type === 'createBus' && action.payload.busId === trackId) {
            return projectTrackThroughPriorBatchActions(
                createPlannedTrack({
                    id: trackId,
                    name: action.payload.name,
                    kind: 'bus',
                    gain: action.payload.initialGain ?? 0.8,
                }),
                context
            );
        }
    }
    return null;
}
