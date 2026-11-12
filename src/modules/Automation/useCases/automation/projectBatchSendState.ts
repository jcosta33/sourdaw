import { trackStore } from '#/modules/Arrangement/stores';
import { resolveSendLevelFields, SEND_LEVEL_LAW } from '#/utils/audioLevelLaw';
import { type AppAction } from '#/utils/handlerContract';

type PlannedBus = { id: string; kind: string; name: string };
type PlannedSend = { busId: string; level: number; preFader: boolean };

/**
 * The bus as it will stand once the earlier members of a batch have run: the live bus, a bus an
 * earlier `createBus` mints under this id, or none once an earlier member removes it.
 */
export function getPlannedBus(busId: string, priorActions: readonly AppAction[]): PlannedBus | undefined {
    let bus: PlannedBus | undefined = trackStore.value?.tracks.find((track) => track.id === busId);
    for (const action of priorActions) {
        if (action.type === 'createBus' && action.payload.busId === busId) {
            bus = { id: busId, kind: 'bus', name: action.payload.name };
        }
        if (
            (action.type === 'discardCreatedTrack' || action.type === 'removeTrack') &&
            action.payload.trackId === busId
        ) {
            bus = undefined;
        }
    }
    return bus;
}

/**
 * The send from a track to a bus as it will stand once the earlier members of a batch have run:
 * an earlier `addSend` lands it, `setSend` moves its level and `removeSend` takes it away.
 */
export function getPlannedSend(
    trackId: string,
    busId: string,
    priorActions: readonly AppAction[]
): PlannedSend | undefined {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === trackId);
    let send = track?.sends.find((candidate) => candidate.busId === busId);
    for (const action of priorActions) {
        if (action.type === 'addSend' && action.payload.trackId === trackId && action.payload.busId === busId) {
            // A send the batch cannot land leaves the plan as it was: the
            // decibel forms answer to the send law like the handler's do, and a
            // refused request creates nothing to plan against.
            const level = resolveSendLevelFields(action.payload, SEND_LEVEL_LAW.unity);
            if (level.ok) {
                send = { busId, level: level.linear, preFader: action.payload.preFader ?? false };
            }
        }
        if (action.type === 'setSend' && action.payload.trackId === trackId && action.payload.busId === busId && send) {
            const level = resolveSendLevelFields(action.payload, send.level);
            if (level.ok) {
                send = { ...send, level: level.linear };
            }
        }
        if (action.type === 'removeSend' && action.payload.trackId === trackId && action.payload.busId === busId) {
            send = undefined;
        }
    }
    return send;
}
