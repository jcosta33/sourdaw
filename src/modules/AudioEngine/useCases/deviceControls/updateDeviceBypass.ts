import { audioEngine } from '../../repositories/createWebAudioEngine';
import { sendNativeDeviceBypass } from '../livePlayback/sendNativeDeviceBypass';

import { nativeBuiltinWriteTarget } from './nativeBuiltinWriteTarget';

/**
 * The bypass door, additive over both carriers the way
 * {@link updateDeviceParam} is over a parameter write (#3946).
 *
 * The Web Audio write always happens: a carried strip's node is gated out of the
 * mix while rolling, but it is the strip's fallback carrier the moment Stop
 * reopens the gate, and it has to already hold the current bypass for that
 * moment. The native send is additive on top of it, for whichever built-in the
 * native session is carrying right now — without it the engine learns a
 * mid-roll bypass only at the next strip rebuild, applying at the next Play,
 * while the musician's toggle moved a node nobody was hearing.
 *
 * A hosted plugin's bypass is not this door's to forward: its device node
 * already writes the instance over the plugin host's own ordered control path,
 * and {@link nativeBuiltinWriteTarget} names built-in bodies only.
 */
export function updateDeviceBypass(trackId: string, deviceId: string, bypassed: boolean): void {
    audioEngine.updateDeviceBypass(trackId, deviceId, bypassed);
    if (nativeBuiltinWriteTarget(trackId, deviceId)) {
        void sendNativeDeviceBypass({ trackId, deviceId, bypassed });
    }
}
