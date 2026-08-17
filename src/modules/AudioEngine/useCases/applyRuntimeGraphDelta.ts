import { type RuntimeGraphDeltaResult } from '../models/RuntimeGraphDelta';
import { audioEngine } from '../repositories/createWebAudioEngine';

export function applyRuntimeGraphDelta(delta: unknown): RuntimeGraphDeltaResult {
    return audioEngine.applyRuntimeGraphDelta(delta);
}
