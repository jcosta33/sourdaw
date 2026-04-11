import { audioEngine } from '../../repositories/createWebAudioEngine';
import { type TrackChannelStrip } from '../../models/AudioEngineState';

export function ensureTrackStrip(trackId: string): TrackChannelStrip {
    return audioEngine.ensureTrackStrip(trackId);
}