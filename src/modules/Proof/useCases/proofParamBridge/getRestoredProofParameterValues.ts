import { getTrackStoreState } from '#/modules/Arrangement/useCases';
import { DEVICE_TYPE_IDS } from '#/utils/nativeDspDeviceTypes';

export function getRestoredProofParameterValues(deviceId: string): Record<string, number> | null {
    const trackState = getTrackStoreState();
    if (!trackState) {
        return null;
    }

    for (const track of trackState.tracks) {
        const device = track.devices.find(
            (candidate) => candidate.id === deviceId && candidate.type === DEVICE_TYPE_IDS.proof
        );
        if (device) {
            return device.parameterValues;
        }
    }

    return null;
}
