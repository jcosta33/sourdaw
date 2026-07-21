import { updateDeviceParam } from '#/modules/AudioEngine/useCases';
import { recordAutomationValue } from '#/modules/Automation/useCases';
import { transportStore } from '#/modules/Transport/stores';

import { getTrackState } from '../../../repositories/track/getTrackState';
import { updateTrack } from '../../../repositories/track/updateTrack';
import { resolveEligibleDeviceWriteTarget } from '../../../stores/resolveEligibleDeviceWriteTarget';
import { type AutomationMode } from '../../../stores/trackStore';

const RECORDING_MODES: ReadonlySet<AutomationMode> = new Set(['write', 'touch', 'latch']);

export function setDeviceParameter(deviceId: string, paramId: string, value: number): boolean {
    // Guard against invalid values that could crash the audio engine
    if (!Number.isFinite(value)) {
        return false;
    }

    const target = resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return false;
    }

    const state = getTrackState();
    if (!state) {
        return false;
    }

    const track = state.tracks.find((candidate) => candidate.id === target.trackId);
    if (!track) {
        return false;
    }

    // Update audio engine (non-blocking)
    updateDeviceParam(target.trackId, target.deviceId, paramId, value);

    // Update only the affected track's store state (not all tracks)
    updateTrack(target.trackId, (currentTrack) => ({
        ...currentTrack,
        devices: currentTrack.devices.map((device) => {
            if (device.id !== target.deviceId) {
                return device;
            }

            return {
                ...device,
                parameterValues: { ...device.parameterValues, [paramId]: value },
            };
        }),
    }));

    // Record automation if playing in a recording mode
    const transport = transportStore.value;
    if (transport?.isPlaying && RECORDING_MODES.has(track.automationMode)) {
        recordAutomationValue(target.trackId, `${target.deviceId}:${paramId}`, value, transport.playheadPosition);
    }

    return true;
}
