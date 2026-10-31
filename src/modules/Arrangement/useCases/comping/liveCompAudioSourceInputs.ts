import { tempoMapStore, transportStore } from '#/modules/Transport/stores';

import { getTrackStoreState } from '../getTrackStoreState';

export function liveCompAudioSourceInputs() {
    return { tracks: getTrackStoreState(), transport: transportStore.value, tempoMap: tempoMapStore.value };
}
