import { getToasterDeviceControls } from '#/modules/AudioEngine/useCases';

export function cancelScheduledToasterHits(deviceId: string): void {
    getToasterDeviceControls(deviceId)?.cancelScheduled();
}
