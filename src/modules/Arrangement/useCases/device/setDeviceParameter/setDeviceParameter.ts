import { updateDeviceParam } from '#/modules/AudioEngine/useCases';
import { recordAutomationValue } from '#/modules/Automation/useCases';
import { transportStore } from '#/modules/Transport/stores';

import { clampDeviceParameterValue, isInternalDeviceParameter } from '../../../models/DeviceParameterLaw';
import { getTrackState } from '../../../repositories/track/getTrackState';
import { updateTrack } from '../../../repositories/track/updateTrack';
import { resolveEligibleDeviceWriteTarget } from '../../../stores/resolveEligibleDeviceWriteTarget';
import { type AutomationMode } from '../../../stores/trackStore';

const RECORDING_MODES: ReadonlySet<AutomationMode> = new Set(['write', 'touch', 'latch']);

type SetDeviceParameterOptions = {
    deleteParameter?: boolean;
    projectOnly?: boolean;
};

export function setDeviceParameter(
    deviceId: string,
    paramId: string,
    value: number,
    options: SetDeviceParameterOptions = {}
): boolean {
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

    const targetDevice = track.devices.find((candidate) => candidate.id === target.deviceId);
    if (!targetDevice) {
        return false;
    }
    if (isInternalDeviceParameter({ deviceType: targetDevice.type, paramId })) {
        return false;
    }

    // The declared range is enforced here rather than trusted upstream. This is
    // the door every direct write comes through — a knob, a model action, MIDI
    // learn, an undo — and none of them checked. `Number.isFinite` above was the
    // only guard the whole path carried, so a control declared 0..1 could be
    // driven to any finite number, leaving the engine's own fallbacks to decide
    // what that meant.
    const clamped = clampDeviceParameterValue({ deviceType: targetDevice.type, paramId, value });

    if (!options.projectOnly) {
        // Update audio engine (non-blocking)
        updateDeviceParam(target.trackId, target.deviceId, paramId, clamped);
    }

    // Update only the affected track's store state (not all tracks)
    updateTrack(target.trackId, (currentTrack) => ({
        ...currentTrack,
        devices: currentTrack.devices.map((device) => {
            if (device.id !== target.deviceId) {
                return device;
            }

            const parameterValues = { ...device.parameterValues };
            if (options.deleteParameter) {
                delete parameterValues[paramId];
            } else {
                parameterValues[paramId] = clamped;
            }

            return {
                ...device,
                parameterValues,
            };
        }),
    }));

    // Record automation if playing in a recording mode
    const transport = transportStore.value;
    if (!options.projectOnly && transport?.isPlaying && RECORDING_MODES.has(track.automationMode)) {
        recordAutomationValue(target.trackId, `${target.deviceId}:${paramId}`, clamped, transport.playheadPosition);
    }

    return true;
}
