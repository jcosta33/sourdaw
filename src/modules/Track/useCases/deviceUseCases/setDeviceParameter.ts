import { getTrackState, updateTrack } from '../../repositories/trackRepository';
import { getTransportState } from '#/modules/Transport/useCases/transportQueries';
import { type AutomationMode } from '../../models/Track';
import { updateDeviceParam } from '#/modules/AudioEngine/useCases/deviceControls';
import { recordAutomationValue } from '#/modules/Automation/useCases/automationRecording';

const RECORDING_MODES: ReadonlySet<AutomationMode> = new Set(['write', 'touch', 'latch']);

export function setDeviceParameter(deviceId: string, paramId: string, value: number): void {
    const state = getTrackState();
    if (!state) {
        return;
    }

    const track = state.tracks.find((t) => t.devices.some((d) => d.id === deviceId));
    if (!track) {
        return;
    }

    // Update audio engine (non-blocking)
    updateDeviceParam(track.id, deviceId, paramId, value);

    // Update only the affected track's store state (not all tracks)
    updateTrack(track.id, (t) => ({
        ...t,
        devices: t.devices.map((d) =>
            d.id === deviceId ? { ...d, parameterValues: { ...d.parameterValues, [paramId]: value } } : d
        ),
    }));

    // Record automation if playing in a recording mode
    const transport = getTransportState();
    if (transport?.isPlaying && RECORDING_MODES.has(track.automationMode)) {
        recordAutomationValue(track.id, `${deviceId}:${paramId}`, value, transport.playheadPosition);
    }
}
