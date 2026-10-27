import { trackStore } from '#/modules/Arrangement/stores';

import { chamberDisclosureLevelFromState } from '../../models/chamberDisclosureLevelFromState';
import { chamberStore } from '../../stores/chamberStore';

/** Project UI metadata changes no engine parameter or live audio state. */
export function hydrateChamberDisclosureFromProject(deviceId: string): void {
    const device = trackStore.value?.tracks
        .flatMap((track) => track.devices)
        .find((candidate) => candidate.id === deviceId && candidate.type === 'dutch-oven');
    const state = chamberStore.value;
    const instance = state?.instances[deviceId];
    if (!device || !state || !instance) {
        return;
    }
    const uiLevel = chamberDisclosureLevelFromState(device.deviceState);
    if (instance.uiLevel === uiLevel) {
        return;
    }
    chamberStore.set({ ...state, instances: { ...state.instances, [deviceId]: { ...instance, uiLevel } } });
}
