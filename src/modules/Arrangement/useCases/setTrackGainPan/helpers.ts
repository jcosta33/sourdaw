import { type updateDeviceParam } from '#/modules/AudioEngine/useCases';

import { type getAllTracks } from '../getAllTracks';

export type ToasterSyncDeps = {
    updateDeviceParam: typeof updateDeviceParam;
    getAllTracks: typeof getAllTracks;
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

    if (toasterDevice) {
        const children = tracks.filter((time) => time.parentId === parent.id);
        const padIndex = children.findIndex((time) => time.id === trackId);
        if (padIndex !== -1) {
            deps.updateDeviceParam(parent.id, toasterDevice.id, `pad_${padIndex}_${paramName}`, value);
        }
    }
}
