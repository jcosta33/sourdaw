import { resolveSendLevelFields, SEND_LEVEL_LAW, toLevelDb } from '#/utils/audioLevelLaw';

import { type MaterializableRuntimeAction } from '../../models/ExecutableRuntimeAction';

import { type MaterializationState, type MaterializationStep } from './MaterializationState';

type Action = Extract<MaterializableRuntimeAction, { type: 'addSend' }>;

export function materializeAddedSend(action: Action, state: MaterializationState): MaterializationStep {
    const { tracksById } = state;
    const sourceTrack = tracksById.get(action.payload.trackId);
    const destinationBus = tracksById.get(action.payload.busId);
    if (!sourceTrack || destinationBus?.kind !== 'bus') {
        return {
            status: 'rejected',
            reason: `Send endpoints are unavailable: ${action.payload.trackId} -> ${action.payload.busId}`,
        };
    }
    if (sourceTrack.sends?.some((send) => send.busId === action.payload.busId)) {
        return {
            status: 'rejected',
            reason: `Send already exists: ${action.payload.trackId} -> ${action.payload.busId}`,
        };
    }
    // The guard has to record the level the send will actually hold,
    // not the form the request stated it in: a later action in the same
    // batch reads this projection to decide what it is changing.
    const level = resolveSendLevelFields(action.payload, SEND_LEVEL_LAW.unity);
    if (!level.ok) {
        return { status: 'rejected', reason: level.reason };
    }
    const existingSends = sourceTrack.sends ?? [];
    const projectedSends = [
        ...existingSends,
        {
            busId: action.payload.busId,
            level: level.linear,
            levelDb: toLevelDb(level.linear),
            preFader: action.payload.preFader ?? false,
        },
    ];
    tracksById.set(action.payload.trackId, { ...sourceTrack, sends: projectedSends });
    return { status: 'accepted', actions: [action] };
}
