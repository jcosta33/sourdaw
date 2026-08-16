import { type RuntimeGraphProjectRevisionValidator } from '../models/RuntimeGraphDelta';
import { audioEngine } from '../repositories/createWebAudioEngine';

/**
 * Binds project freshness at composition time without giving AudioEngine a
 * dependency on the CRDT document or its stores.
 */
export function configureRuntimeGraphProjectRevisionValidator(validator: RuntimeGraphProjectRevisionValidator): void {
    audioEngine.setRuntimeGraphProjectRevisionValidator(validator);
}
