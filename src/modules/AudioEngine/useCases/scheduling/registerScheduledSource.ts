import { audioEngine } from '../../repositories/createWebAudioEngine';

/**
 * Put a scheduled source node under the engine's stop sweep (audit MD-6).
 *
 * Built-in synth and kit voices are bare oscillators the scheduler writes
 * straight into a track strip. Their handles used to be dropped on the floor,
 * so nothing — not transport stop, not a panic — could silence them and they
 * rang on for the rest of their programmed duration. Registering them makes
 * `stopAllScheduled` reach them.
 */
export function registerScheduledSource(node: AudioScheduledSourceNode): void {
    audioEngine.registerScheduledSource(node);
}
