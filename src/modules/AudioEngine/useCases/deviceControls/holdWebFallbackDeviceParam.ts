import { clampDeviceParamWrite } from '#/modules/Arrangement/stores';

import { audioEngine } from '../../repositories/createWebAudioEngine';
import { nativeBuiltinBody } from '../livePlayback/nativeBuiltinBodies';

import { deviceTypeOnStrip } from './deviceTypeOnStrip';

/**
 * Keep a carried built-in's Web Audio node on the automation curve without
 * letting that value reach the engine (#3893).
 *
 * While the native session carries a built-in, its parameters are stamped
 * block-accurately from the engine's own queue, ahead of the playhead — so a
 * tick-grid value sent natively as well would land late and drag the parameter
 * back to where the curve was a tick ago. Yet the strip's Web Audio node is its
 * fallback carrier, silent only for as long as the session holds the gate
 * closed: `stopNativeLiveGraphSession` claims the carried set empty at Stop and
 * the strip is heard through Web Audio again, holding whatever it last
 * received. This is the write that keeps that value current, and it is
 * `updateDeviceParam`'s web half without its native half.
 *
 * A device the engine builds no built-in body for takes nothing from this door.
 * A hosted plugin's Web Audio path *is* IPC to the very instance the engine
 * stamps, so writing it here would be the double drive this exists to avoid; a
 * web-only device is never carried, so its curve belongs on the ordinary door.
 */
export function holdWebFallbackDeviceParam(trackId: string, deviceId: string, paramId: string, value: number): void {
    const type = deviceTypeOnStrip(trackId, deviceId);
    if (type === null || !nativeBuiltinBody(type)) {
        return;
    }
    audioEngine.updateDeviceParam(trackId, deviceId, paramId, clampDeviceParamWrite({ deviceId, paramId, value }));
}
