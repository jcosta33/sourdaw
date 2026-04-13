import { type Track } from '#/modules/Arrangement/models/Track';

export function hasToasterDevice(track: Track): boolean {
    return track.devices.some((device) => device.type === 'toaster');
}
