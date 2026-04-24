import { updateDeviceParam } from '#/modules/AudioEngine/useCases';
import { recordAutomationValue } from '#/modules/Automation/useCases';
import { getTransportState } from '#/modules/Transport/useCases';

import { getTrackState } from '../../../repositories/track/getTrackState';
import { updateTrack } from '../../../repositories/track/updateTrack';
import { type AutomationMode } from '../../../stores/trackStore';

const RECORDING_MODES: ReadonlySet<AutomationMode> = new Set(['write', 'touch', 'latch']);

export function setDeviceParameter(deviceId: string, paramId: string, value: number): void {
    // Guard against invalid values that could crash the audio engine
    if (!Number.isFinite(value)) {
        return;
    }

    const state = getTrackState();
    if (!state) {
        return;
    }

    const track = state.tracks.find((time) => time.devices.some((data) => data.id === deviceId));
    if (!track) {
        return;
    }

    // Update audio engine (non-blocking)
    updateDeviceParam(track.id, deviceId, paramId, value);

    // Update only the affected track's store state (not all tracks)
    updateTrack(track.id, (time) => ({
        ...time,
        devices: time.devices.map((data) =>
            data.id === deviceId ? { ...data, parameterValues: { ...data.parameterValues, [paramId]: value } } : data
        ),
    }));

    // Record automation if playing in a recording mode
    const transport = getTransportState();
    if (transport?.isPlaying && RECORDING_MODES.has(track.automationMode)) {
        recordAutomationValue(track.id, `${deviceId}:${paramId}`, value, transport.playheadPosition);
    }
}
