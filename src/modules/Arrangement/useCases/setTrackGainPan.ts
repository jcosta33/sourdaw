import { getTrackById, updateTrack } from '../repositories/track';
import { getTransportState } from '#/modules/Transport/useCases/transportQueries';
import { recordAutomationValue } from '#/modules/Automation/useCases/automationRecording/recordAutomationValue';
import { type AutomationMode, type InputMonitoring } from '../models/Track';
import { startInputMonitoring, stopInputMonitoring } from '#/modules/AudioEngine/useCases/audioRecorder';
import {
    setTrackGain as engineSetTrackGain,
    setTrackPan as engineSetTrackPan,
} from '#/modules/AudioEngine/useCases/trackAudioControls';

import { updateDeviceParam } from '#/modules/AudioEngine/useCases/deviceControls';
import { trackStore } from '../stores/trackStore';

const RECORDING_MODES: ReadonlySet<AutomationMode> = new Set(['write', 'touch', 'latch']);

function syncToasterPadParam(trackId: string, paramName: string, value: number): void {
    const tracks = trackStore.value?.tracks || [];
    const track = tracks.find(t => t.id === trackId);
    if (!track?.parentId) return;

    const parent = tracks.find(t => t.id === track.parentId);
    if (!parent) return;
    
    const toasterDevice = parent.devices.find(d => d.type === 'toaster');
    
    if (toasterDevice) {
        const children = tracks.filter(t => t.parentId === parent.id);
        const padIndex = children.findIndex(t => t.id === trackId);
        if (padIndex !== -1) {
            updateDeviceParam(parent.id, toasterDevice.id, `pad_${padIndex}_${paramName}`, value);
        }
    }
}

function maybeRecordAutomation(trackId: string, parameterId: string, value: number): void {
    const transport = getTransportState();
    if (!transport?.isPlaying) return;

    const track = getTrackById(trackId);
    if (!track || !RECORDING_MODES.has(track.automationMode)) return;

    recordAutomationValue(trackId, parameterId, value, transport.playheadPosition);
}

export function setTrackGain(trackId: string, gain: number): void {
    const clamped = Math.max(0, Math.min(1, gain));
    updateTrack(trackId, (t) => ({ ...t, gain: clamped }));
    engineSetTrackGain(trackId, clamped);
    syncToasterPadParam(trackId, 'volume', clamped);
    maybeRecordAutomation(trackId, 'gain', clamped);
}

export function setTrackPan(trackId: string, pan: number): void {
    const clamped = Math.max(-50, Math.min(50, pan));
    updateTrack(trackId, (t) => ({ ...t, pan: clamped }));
    engineSetTrackPan(trackId, clamped);
    syncToasterPadParam(trackId, 'pan', clamped / 50); // Scale to -1.0..1.0 for engine
    maybeRecordAutomation(trackId, 'pan', clamped);
}

export function setTrackColor(trackId: string, color: string): void {
    updateTrack(trackId, (t) => ({ ...t, color }));
}

export function setTrackNotes(trackId: string, notes: string): void {
    updateTrack(trackId, (t) => ({ ...t, notes }));
}

export function setInputMonitoring(trackId: string, mode: InputMonitoring): void {
    updateTrack(trackId, (t) => ({ ...t, inputMonitoring: mode }));

    // Actually start/stop the microphone stream on the audio engine.
    if (mode === 'on') {
        void startInputMonitoring(trackId);
    } else {
        stopInputMonitoring();
    }
}
