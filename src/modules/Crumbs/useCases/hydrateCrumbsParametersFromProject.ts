import { trackStore } from '#/modules/Arrangement/stores';

import { replaceCrumbsProjectParameters } from '../stores/crumbsStore';

export function hydrateCrumbsParametersFromProject(deviceId: string): void {
    for (const track of trackStore.value?.tracks ?? []) {
        const device = track.devices.find((candidate) => candidate.id === deviceId);
        if (!device) {
            continue;
        }

        replaceCrumbsProjectParameters(deviceId, device.parameterValues);
        return;
    }
}
