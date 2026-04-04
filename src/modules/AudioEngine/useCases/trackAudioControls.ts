/**
 * Use case for track-level audio controls.
 *
 * Wraps the AudioEngine track channel strip operations and provides
 * a domain-meaningful API for other modules to control track audio.
 */
import { audioEngine } from '../repositories/createWebAudioEngine';
import { type TrackChannelStrip } from '../models/AudioEngineState';

export function ensureTrackStrip(trackId: string): TrackChannelStrip {
    return audioEngine.ensureTrackStrip(trackId);
}

export function getTrackStrip(trackId: string): TrackChannelStrip | undefined {
    return audioEngine.getTrackStrip(trackId);
}

export function setTrackGain(trackId: string, gain: number): void {
    audioEngine.setTrackGain(trackId, gain);
}

export function setTrackPan(trackId: string, pan: number): void {
    audioEngine.setTrackPan(trackId, pan);
}

export function setTrackMute(trackId: string, muted: boolean, restoreGain?: number): void {
    audioEngine.setTrackMute(trackId, muted, restoreGain);
}

export function setTrackOutput(trackId: string, outputId: string): void {
    audioEngine.setTrackOutput(trackId, outputId);
}

export function getTrackPeakLevel(trackId: string): number {
    return audioEngine.getTrackPeakLevel(trackId);
}
