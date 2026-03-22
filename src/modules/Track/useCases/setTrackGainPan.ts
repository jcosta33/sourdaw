import { getTrackById, updateTrack } from '../repositories/trackRepository';
import { getTransportState } from '#/modules/Transport/useCases/transportQueries';
import { recordAutomationValue } from '#/modules/Track/useCases/automationRecording';
import { type AutomationMode, type InputMonitoring } from '../models/Track';
import {
    setTrackGain as engineSetTrackGain,
    setTrackPan as engineSetTrackPan,
} from '#/modules/AudioEngine/useCases/trackAudioControls';

const RECORDING_MODES: ReadonlySet<AutomationMode> = new Set(['write', 'touch', 'latch']);

function maybeRecordAutomation(trackId: string, parameterId: string, value: number): void {
    const transport = getTransportState();
    if (!transport?.isPlaying) {
        return;
    }

    const track = getTrackById(trackId);
    if (!track || !RECORDING_MODES.has(track.automationMode)) {
        return;
    }

    recordAutomationValue(trackId, parameterId, value, transport.playheadPosition);
}

export function setTrackGain(trackId: string, gain: number): void {
    const clamped = Math.max(0, Math.min(1, gain));
    updateTrack(trackId, (t) => ({ ...t, gain: clamped }));
    engineSetTrackGain(trackId, clamped);
    maybeRecordAutomation(trackId, 'gain', clamped);
}

export function setTrackPan(trackId: string, pan: number): void {
    const clamped = Math.max(-50, Math.min(50, pan));
    updateTrack(trackId, (t) => ({ ...t, pan: clamped }));
    engineSetTrackPan(trackId, clamped);
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
}
