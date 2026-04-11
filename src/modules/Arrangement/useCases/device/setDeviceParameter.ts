import { getTrackState } from '../../repositories/track/getTrackState';
import { updateTrack } from '../../repositories/track/updateTrack';
import { getTransportState } from '#/modules/Transport/useCases';
import { type AutomationMode } from '../../stores/trackStore';
import { updateDeviceParam } from '#/modules/AudioEngine/useCases';
import { recordAutomationValue } from '#/modules/Automation';

const RECORDING_MODES: ReadonlySet<AutomationMode> = new Set(['write', 'touch', 'latch']);

export function persistDeviceParam(deviceId: string, paramId: string, value: number): void {
    if (!Number.isFinite(value)) return;
    const state = getTrackState();
    if (!state) return;
    const track = state.tracks.find((t) => t.devices.some((d) => d.id === deviceId));
    if (!track) return;
    updateTrack(track.id, (t) => ({
        ...t,
        devices: t.devices.map((d) =>
            d.id === deviceId ? { ...d, parameterValues: { ...d.parameterValues, [paramId]: value } } : d
        ),
    }));
}

export function setDeviceParameter(deviceId: string, paramId: string, value: number): void {
    // Guard against invalid values that could crash the audio engine
    if (!Number.isFinite(value)) {
        return;
    }

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
