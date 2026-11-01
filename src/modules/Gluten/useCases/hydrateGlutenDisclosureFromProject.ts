import { trackStore } from '#/modules/Arrangement/stores';

import { glutenDisclosureLevelFromState } from '../models/GlutenDisclosure';
import { getGlutenState, setGlutenUiLevel } from '../stores/glutenStore';

/** Re-project UI metadata without replacing the live patch or touching meters/audio. */
export function hydrateGlutenDisclosureFromProject(deviceId: string): void {
    const device = trackStore.value?.tracks
        .flatMap((track) => track.devices)
        .find((candidate) => candidate.id === deviceId && candidate.type === 'gluten');
    if (!device) {
        return;
    }
    const level = glutenDisclosureLevelFromState(device.deviceState);
    if (getGlutenState(deviceId).uiLevel !== level) {
        setGlutenUiLevel(deviceId, level);
    }
}
