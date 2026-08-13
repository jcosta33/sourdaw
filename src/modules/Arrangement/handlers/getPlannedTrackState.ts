import { type HandlerValidationContext } from '#/utils/handlerContract';

import { type Track } from '../models/Track';
import { getTrackStoreState } from '../useCases/getTrackStoreState';

import { projectTrackThroughPriorBatchActions } from './projectTrackThroughPriorBatchActions';

function createPlannedTrack(input: {
    id: string;
    name: string;
    kind: 'audio' | 'bus' | 'folder';
    gain: number;
}): Track {
    const alternativeId = `planned-alternative-${input.id}`;
    return {
        id: input.id,
        name: input.name,
        kind: input.kind,
        muted: false,
        soloed: false,
        armed: false,
        gain: input.gain,
        pan: 0,
        color: '#000000',
        clips: [],
        devices: [],
        sends: [],
        midiFx: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: input.kind === 'bus',
        notes: '',
        inputId: null,
        activeAlternativeId: alternativeId,
        alternatives: [{ id: alternativeId, name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
    };
}

export function getPlannedTrackState(context: HandlerValidationContext, trackId: string): Track | null {
    const current = getTrackStoreState()?.tracks.find((track) => track.id === trackId);
    if (current) {
        return projectTrackThroughPriorBatchActions(current, context);
    }
    for (const action of context.actions.slice(0, context.actionIndex)) {
        if (
            action.type === 'addTrack' &&
            action.payload.id === trackId &&
            action.payload.kind !== 'master' &&
            action.payload.kind !== 'midi'
        ) {
            return projectTrackThroughPriorBatchActions(
                createPlannedTrack({
                    id: trackId,
                    name: action.payload.name,
                    kind: action.payload.kind,
                    gain: 0.8,
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
