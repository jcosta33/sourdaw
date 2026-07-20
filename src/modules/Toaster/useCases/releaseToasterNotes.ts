import { getToasterDeviceControls } from '#/modules/AudioEngine/useCases';

export function releaseToasterNotes(deviceId: string): void {
    getToasterDeviceControls(deviceId)?.allNotesOff();
}
