import { audioEngine } from '../../repositories/createWebAudioEngine';
import { isCrumbsChainDevice } from '../livePlayback/isCrumbsChainDevice';
import { isDeviceCarriedByNativeSession } from '../livePlayback/isDeviceCarriedByNativeSession';
import { sendNativeDeviceBypass } from '../livePlayback/sendNativeDeviceBypass';

import { deviceTypeOnStrip } from './deviceTypeOnStrip';
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
 *
 * A carried Crumbs device takes the send too (#4204). The engine splices its
 * instance rather than building a body for it, so `nativeBuiltinWriteTarget`
 * resolves nothing for it — but the chain is still the only writer of that
 * device's bypass (`set_crumbs_param` carries the sampler's parameters and
 * nothing else), which is why the native side admits the write where it refuses
 * a hosted plugin's. Without this branch the panel's bypass button goes dead the
 * moment the strip is carried natively. `nativeBuiltinWriteTarget` itself stays
 * built-in-only: a parameter write is spelled in the body's vocabulary, and
 * Crumbs has none there.
 */
function carriesNativeCrumbs(trackId: string, deviceId: string): boolean {
    const type = deviceTypeOnStrip(trackId, deviceId);
    return type !== null && isCrumbsChainDevice(type) && isDeviceCarriedByNativeSession(trackId, deviceId);
}

export function updateDeviceBypass(trackId: string, deviceId: string, bypassed: boolean): void {
    audioEngine.updateDeviceBypass(trackId, deviceId, bypassed);
    if (nativeBuiltinWriteTarget(trackId, deviceId) || carriesNativeCrumbs(trackId, deviceId)) {
        void sendNativeDeviceBypass({ trackId, deviceId, bypassed });
    }
}
