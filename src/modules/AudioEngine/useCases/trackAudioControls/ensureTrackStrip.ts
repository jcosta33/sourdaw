import { type TrackChannelStrip } from '../../models/AudioEngineState';
import { audioEngine } from '../../repositories/createWebAudioEngine';

export function ensureTrackStrip(trackId: string): TrackChannelStrip {
    return audioEngine.ensureTrackStrip(trackId);
}
