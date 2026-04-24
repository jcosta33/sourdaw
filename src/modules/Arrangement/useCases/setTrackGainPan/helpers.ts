import { type updateDeviceParam } from '#/modules/AudioEngine/useCases';
import { type recordAutomationValue } from '#/modules/Automation/useCases';
import type { transportStore } from '#/modules/Transport/stores';

import { type getTrackById } from '../../repositories/track/getTrackById';
import { type AutomationMode } from '../../stores/trackStore';
import { type getAllTracks } from '../getAllTracks';

export const RECORDING_MODES: ReadonlySet<AutomationMode> = new Set(['write', 'touch', 'latch']);

export type ToasterSyncDeps = {
    updateDeviceParam: typeof updateDeviceParam;
    getAllTracks: typeof getAllTracks;
};

export function syncToasterPadParam(trackId: string, paramName: string, value: number, deps: ToasterSyncDeps): void {
    const tracks = deps.getAllTracks();
    const track = tracks.find((t) => t.id === trackId);
    if (!track?.parentId) {
        return;
    }

    const parent = tracks.find((t) => t.id === track.parentId);
    if (!parent) {
        return;
    }

    const toasterDevice = parent.devices.find((d) => d.type === 'toaster');

    if (toasterDevice) {
        const children = tracks.filter((t) => t.parentId === parent.id);
        const padIndex = children.findIndex((t) => t.id === trackId);
        if (padIndex !== -1) {
            deps.updateDeviceParam(parent.id, toasterDevice.id, `pad_${padIndex}_${paramName}`, value);
        }
    }
}

export type AutomationRecordDeps = {
    getTransportValue: () => (typeof transportStore)['value'];
    getTrackById: typeof getTrackById;
    recordAutomationValue: typeof recordAutomationValue;
};

export function maybeRecordAutomation(
    deps: AutomationRecordDeps,
    trackId: string,
    parameterId: string,
    value: number
): void {
    const transport = deps.getTransportValue();
    if (!transport?.isPlaying) {
        return;
    }

    const track = deps.getTrackById(trackId);
    if (!track || !RECORDING_MODES.has(track.automationMode)) {
        return;
    }

    deps.recordAutomationValue(trackId, parameterId, value, transport.playheadPosition);
}
