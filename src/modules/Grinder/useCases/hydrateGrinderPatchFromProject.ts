import { trackStore } from '#/modules/Arrangement/stores';

import { replaceGrinderProjectParameters } from '../stores/grinderStore';

export function hydrateGrinderPatchFromProject(deviceId: string): void {
    for (const track of trackStore.value?.tracks ?? []) {
        const device = track.devices.find((candidate) => candidate.id === deviceId);
        if (!device) {
            continue;
        }

        replaceGrinderProjectParameters(deviceId, device.parameterValues);
        return;
    }
}
