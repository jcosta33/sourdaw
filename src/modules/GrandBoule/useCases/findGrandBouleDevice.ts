import { trackStore } from '#/modules/Arrangement/stores';
import { DEVICE_TYPE_IDS } from '#/utils/nativeDspDeviceTypes';

export function findGrandBouleDevice(deviceId: string) {
    for (const track of trackStore.value?.tracks ?? []) {
        const device = track.devices.find(
            (candidate) => candidate.id === deviceId && candidate.type === DEVICE_TYPE_IDS.grandBoule
        );
        if (device) {
            return { trackId: track.id, device };
        }
    }
    return undefined;
}
