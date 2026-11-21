import { type TrackChannelStrip } from '../../models/AudioEngineState';
import { audioEngine } from '../../repositories/createWebAudioEngine';

export function getTrackStrip(trackId: string): TrackChannelStrip | undefined {
    return audioEngine.getTrackStrip(trackId);
}
