import { type RuntimeGraphTopologyValidator } from '../models/RuntimeGraphDelta';
import { audioEngine } from '../repositories/createWebAudioEngine';

/** Binds project-owned topology validation without giving AudioEngine project-store access. */
export function configureRuntimeGraphTopologyValidator(validator: RuntimeGraphTopologyValidator): void {
    audioEngine.setRuntimeGraphTopologyValidator(validator);
}
