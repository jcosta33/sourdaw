import { trackStore } from '#/modules/Arrangement/stores';
import { type AppAction } from '#/utils/handlerContract';

type PlannedBus = { id: string; kind: string; name: string };

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
