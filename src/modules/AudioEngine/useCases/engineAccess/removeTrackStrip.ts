import { audioEngine } from '../../repositories/createWebAudioEngine';

/**
 * Tears down a track's channel strip in the audio engine, disposing its nodes
 * and sweeping any sends/sidechain taps that used the track as a source.
 *
 * Must be called when a track is deleted from project truth — otherwise the
 * BusNode/TrackNode keeps processing in the live graph (a leaked node).
 */
export function removeTrackStrip(trackId: string): void {
    audioEngine.removeTrackStrip(trackId);
}
