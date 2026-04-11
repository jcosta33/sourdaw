import { getAllTracks } from '#/modules/Arrangement/useCases';

export function getFirstToasterDeviceId(): string | null {
    for (const track of getAllTracks()) {
        const device = track.devices.find((d) => d.type === 'toaster');
        if (device) {
            return device.id;
        }
    }
    return null;
}