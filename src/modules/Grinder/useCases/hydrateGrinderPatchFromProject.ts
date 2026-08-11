import { trackStore } from '#/modules/Arrangement/stores';

import { replaceGrinderProjectParameters } from '../stores/grinderStore';

export function hydrateGrinderPatchFromProject(deviceId: string): void {
    const device = trackStore.value?.tracks.flatMap((track) => track.devices).find((entry) => entry.id === deviceId);
    if (!device) {
        return;
    }
    replaceGrinderProjectParameters(deviceId, device.parameterValues);
}
