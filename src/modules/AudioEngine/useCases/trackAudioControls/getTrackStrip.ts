import { audioEngine } from '../../repositories/createWebAudioEngine';
import { type TrackChannelStrip } from '../../models/AudioEngineState';

export function getTrackStrip(trackId: string): TrackChannelStrip | undefined {
    return audioEngine.getTrackStrip(trackId);
}