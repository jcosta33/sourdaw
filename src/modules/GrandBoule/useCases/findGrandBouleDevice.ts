import { trackStore } from '#/modules/Arrangement/stores';
import { DEVICE_TYPE_IDS } from '#/utils/nativeDspDeviceTypes';

export function findGrandBouleDevice(deviceId: string) {
    return trackStore.value?.tracks
        .flatMap((track) => track.devices)
        .find((candidate) => candidate.id === deviceId && candidate.type === DEVICE_TYPE_IDS.grandBoule);
}
