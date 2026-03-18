/**
 * Use case for track-level audio controls.
 *
 * Wraps the AudioEngine track channel strip operations and provides
 * a domain-meaningful API for other modules to control track audio.
 */
import { audioEngine } from '../repositories/audioEngineInstance';
import { type TrackChannelStrip } from '../models/AudioEngineState';

export const ensureTrackStrip = (trackId: string): TrackChannelStrip => {
    return audioEngine.ensureTrackStrip(trackId);
};

export const getTrackStrip = (trackId: string): TrackChannelStrip | undefined => {
    return audioEngine.getTrackStrip(trackId);
};

export const removeTrackStrip = (trackId: string): void => {
    audioEngine.removeTrackStrip(trackId);
};

export const setTrackGain = (trackId: string, gain: number): void => {
    audioEngine.setTrackGain(trackId, gain);
};

export const setTrackPan = (trackId: string, pan: number): void => {
    audioEngine.setTrackPan(trackId, pan);
};

export const setTrackMute = (trackId: string, muted: boolean, restoreGain?: number): void => {
    audioEngine.setTrackMute(trackId, muted, restoreGain);
};

export const setTrackOutput = (trackId: string, outputId: string): void => {
    audioEngine.setTrackOutput(trackId, outputId);
};

export const getTrackPeakLevel = (trackId: string): number => {
    return audioEngine.getTrackPeakLevel(trackId);
};
