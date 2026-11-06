import { type ControlRoomMonitoring } from '../../models/AudioEngineState';
import { audioEngine } from '../../repositories/createWebAudioEngine';

/**
 * Apply control-room monitoring to the engine's listening path only, never the
 * programme: the insert sits strictly downstream of the fader and the meters.
 * The engine applies gains and reads no monitoring state, so the dim arrives
 * already folded to a linear multiplier.
 */
export function setControlRoomMonitoring(monitoring: ControlRoomMonitoring): void {
    audioEngine.setControlRoomMonitoring(monitoring);
}
