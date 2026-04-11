import { inject } from '#/infra/di/inject';
import { getTrackById } from '../repositories/track/getTrackById';
import { updateTrack } from '../repositories/track/updateTrack';
import { getTransportState } from '#/modules/Transport/useCases';
import { getAllTracks } from '#/modules/Arrangement/useCases/getAllTracks';
import { recordAutomationValue } from '#/modules/Automation';
import { type AutomationMode, type InputMonitoring } from '../stores/trackStore';
import {
    startInputMonitoring,
    stopInputMonitoring,
    setTrackGain as engineSetTrackGain,
    setTrackPan as engineSetTrackPan,
    updateDeviceParam,
} from '#/modules/AudioEngine/useCases';

const RECORDING_MODES: ReadonlySet<AutomationMode> = new Set(['write', 'touch', 'latch']);

type ToasterSyncDeps = {
    updateDeviceParam: typeof updateDeviceParam;
    getAllTracks: typeof getAllTracks;
};

function syncToasterPadParam(trackId: string, paramName: string, value: number, deps: ToasterSyncDeps): void {
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

type AutomationRecordDeps = {
    getTransportState: typeof getTransportState;
    getTrackById: typeof getTrackById;
    recordAutomationValue: typeof recordAutomationValue;
};

function maybeRecordAutomation(
    deps: AutomationRecordDeps,
    trackId: string,
    parameterId: string,
    value: number
): void {
    const transport = deps.getTransportState();
    if (!transport?.isPlaying) {
        return;
    }

    const track = deps.getTrackById(trackId);
    if (!track || !RECORDING_MODES.has(track.automationMode)) {
        return;
    }

    deps.recordAutomationValue(trackId, parameterId, value, transport.playheadPosition);
}

export const setTrackGain = inject({
    getTrackById,
    updateTrack,
    engineSetTrackGain,
    getTransportState,
    recordAutomationValue,
    updateDeviceParam,
    getAllTracks,
})(
    ({ getTrackById, updateTrack, engineSetTrackGain, getTransportState, recordAutomationValue, updateDeviceParam, getAllTracks }) =>
        function setTrackGain(trackId: string, gain: number): void {
            const clamped = Math.max(0, Math.min(1, gain));
            updateTrack(trackId, (t) => ({ ...t, gain: clamped }));
            engineSetTrackGain(trackId, clamped);
            syncToasterPadParam(trackId, 'volume', clamped, { updateDeviceParam, getAllTracks });
            maybeRecordAutomation({ getTransportState, getTrackById, recordAutomationValue }, trackId, 'gain', clamped);
        }
);

export const setTrackPan = inject({
    getTrackById,
    updateTrack,
    engineSetTrackPan,
    getTransportState,
    recordAutomationValue,
    updateDeviceParam,
    getAllTracks,
})(
    ({ getTrackById, updateTrack, engineSetTrackPan, getTransportState, recordAutomationValue, updateDeviceParam, getAllTracks }) =>
        function setTrackPan(trackId: string, pan: number): void {
            const clamped = Math.max(-50, Math.min(50, pan));
            updateTrack(trackId, (t) => ({ ...t, pan: clamped }));
            engineSetTrackPan(trackId, clamped);
            syncToasterPadParam(trackId, 'pan', clamped / 50, { updateDeviceParam, getAllTracks });
            maybeRecordAutomation({ getTransportState, getTrackById, recordAutomationValue }, trackId, 'pan', clamped);
        }
);

export const setTrackColor = inject({ updateTrack })(
    ({ updateTrack }) =>
        function setTrackColor(trackId: string, color: string): void {
            updateTrack(trackId, (t) => ({ ...t, color }));
        }
);

export const setTrackNotes = inject({ updateTrack })(
    ({ updateTrack }) =>
        function setTrackNotes(trackId: string, notes: string): void {
            updateTrack(trackId, (t) => ({ ...t, notes }));
        }
);

export const setInputMonitoring = inject({ updateTrack, startInputMonitoring, stopInputMonitoring })(
    ({ updateTrack, startInputMonitoring, stopInputMonitoring }) =>
        function setInputMonitoring(trackId: string, mode: InputMonitoring): void {
            updateTrack(trackId, (t) => ({ ...t, inputMonitoring: mode }));

            if (mode === 'on') {
                startInputMonitoring(trackId);
            } else {
                stopInputMonitoring();
            }
        }
);
