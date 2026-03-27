import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { automationStore } from '#/modules/Automation/stores/automationStore';
import { getAutomationValueAtBeat } from '#/modules/Automation/useCases/automation/getAutomationValueAtBeat';
import { isRecordingAutomation } from '#/modules/Automation/useCases/automationRecording/isRecordingAutomation';
import { getEffectiveGain } from '#/modules/Arrangement/useCases/vca';
import {
    ensureTrackStrip,
    setTrackGain as engineSetTrackGain,
    setTrackPan as engineSetTrackPan,
} from '#/modules/AudioEngine/useCases/trackAudioControls';
import { updateDeviceParam } from '#/modules/AudioEngine/useCases/deviceControls';

export function applyVcaGains(): void {
    const tracks = trackStore.value?.tracks;
    if (!tracks) {
        return;
    }
    for (const track of tracks) {
        if (!track.vcaGroupId || track.muted) {
            continue;
        }
        const effective = getEffectiveGain(track.id, track.gain);
        engineSetTrackGain(track.id, effective);
    }
}

export function applyAutomation(currentBeat: number): void {
    const autoState = automationStore.value;
    if (!autoState) {
        return;
    }

    const tracks = trackStore.value?.tracks;

    for (const lane of autoState.lanes) {
        if (lane.points.length === 0) {
            continue;
        }

        const track = tracks?.find((t) => t.id === lane.trackId);
        if (!track || track.automationMode === 'off') {
            continue;
        }

        if (lane.clipId) {
            const clip = track.clips.find((c) => c.id === lane.clipId);
            if (!clip || currentBeat < clip.startBeat || currentBeat > clip.endBeat) {
                continue;
            }
        }

        if (isRecordingAutomation(lane.trackId, lane.parameterId)) {
            continue;
        }

        const value = getAutomationValueAtBeat(lane.id, currentBeat);
        if (value === null) {
            continue;
        }

        if (lane.parameterId === 'gain') {
            engineSetTrackGain(lane.trackId, value);
        } else if (lane.parameterId === 'pan') {
            engineSetTrackPan(lane.trackId, value * 100 - 50);
        } else {
            for (const device of track.devices) {
                if (device.parameterValues[lane.parameterId] !== undefined) {
                    updateDeviceParam(lane.trackId, device.id, lane.parameterId, value);
                    break;
                }
            }
        }
    }
}

// Re-export to avoid breaking callers that may import from this path
export { ensureTrackStrip };
