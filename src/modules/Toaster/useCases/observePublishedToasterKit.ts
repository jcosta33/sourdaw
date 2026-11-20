import { type DeviceStateChunkSnapshot } from '#/modules/Arrangement/events';
import { trackStore } from '#/modules/Arrangement/stores';
import { jsonValuesEqual } from '#/utils/jsonSemanticEquality';
import { DEVICE_TYPE_IDS } from '#/utils/nativeDspDeviceTypes';

import { captureToasterDeviceLifetime } from '../stores/toasterStore';

// The source belongs to the loaded device's lifetime. A missing chunk on its
// own is normal and must not erase an in-flight preview.
const observedChunks = new WeakMap<object, DeviceStateChunkSnapshot | null>();

export function observePublishedToasterKit(input: {
    deviceId: string;
    trackId: string;
    initial?: boolean;
    committedReplacement?: boolean;
}): { chunk: DeviceStateChunkSnapshot | null } | null {
    const { deviceId, trackId, initial, committedReplacement } = input;
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === trackId);
    const device = track?.devices.find((candidate) => candidate.id === deviceId);
    if (device?.type !== DEVICE_TYPE_IDS.toaster) {
        return null;
    }
    const chunk = device.deviceState ?? null;
    const lifetime = captureToasterDeviceLifetime(deviceId);
    if (!lifetime) {
        return committedReplacement ? { chunk } : null;
    }

    const previous = observedChunks.get(lifetime) ?? null;
    observedChunks.set(lifetime, chunk);
    if (initial || previous === chunk || jsonValuesEqual(previous, chunk)) {
        return null;
    }
    return { chunk };
}
