import { type updateDeviceParam } from '#/modules/AudioEngine/useCases';

import { resolveEligibleDeviceWriteTarget } from '../../stores/resolveEligibleDeviceWriteTarget';
import { type getAllTracks } from '../getAllTracks';

export type ToasterSyncDeps = {
    updateDeviceParam: typeof updateDeviceParam;
    getAllTracks: typeof getAllTracks;
    resolveEligibleDeviceWriteTarget?: typeof resolveEligibleDeviceWriteTarget;
};

export function syncToasterPadParam(trackId: string, paramName: string, value: number, deps: ToasterSyncDeps): void {
    const tracks = deps.getAllTracks();
    const track = tracks.find((time) => time.id === trackId);
    if (!track?.parentId) {
        return;
    }

    const parent = tracks.find((time) => time.id === track.parentId);
    if (!parent) {
        return;
    }

    const toasterDevice = parent.devices.find((data) => data.type === 'toaster');
    if (!toasterDevice) {
        return;
    }
    const resolveTarget = deps.resolveEligibleDeviceWriteTarget ?? resolveEligibleDeviceWriteTarget;
    const target = resolveTarget(toasterDevice.id);
    if (target.status !== 'eligible' || target.trackId !== parent.id) {
        return;
    }

    const children = tracks.filter((time) => time.parentId === parent.id);
    const padIndex = children.findIndex((time) => time.id === trackId);
    if (padIndex === -1) {
        return;
    }

    deps.updateDeviceParam(target.trackId, target.deviceId, `pad_${padIndex}_${paramName}`, value);
}
