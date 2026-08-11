import { trackStore } from '#/modules/Arrangement/stores';

import { replaceCrumbsProjectParameters } from '../stores/crumbsStore';

export function hydrateCrumbsParametersFromProject(deviceId: string): void {
    const device = trackStore.value?.tracks.flatMap((track) => track.devices).find((entry) => entry.id === deviceId);
    if (!device) {
        return;
    }
    replaceCrumbsProjectParameters(deviceId, device.parameterValues);
}
