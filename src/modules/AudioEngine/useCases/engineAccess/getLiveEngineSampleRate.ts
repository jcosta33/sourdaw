import { audioEngine } from '../../repositories/createWebAudioEngine';

import { isEngineAudioAvailable } from './isEngineAudioAvailable';

/**
 * The rate the live engine renders audio at, or `undefined` when it renders no
 * audio at all.
 *
 * The discriminator is the engine's availability, not the presence of a
 * context, because a context is always present: when construction throws, the
 * engine falls back to a silent `OfflineAudioContext` shim and keeps serving it
 * from the same field. That shim is built at a hardcoded 44100, so reading the
 * field alone reports a confident rate that nothing renders at — the exact
 * substitution this accessor exists to refuse, moved one layer down into the
 * shim's constructor argument.
 *
 * `getAudioSampleRate` reports the shim's rate on purpose: a meter drawing a
 * frequency axis needs some rate and none of it is audible anyway. An
 * activation is the opposite case — a plugin activated on the shim's rate is
 * detuned, and reports a latency scaled by the same wrong number, for as long
 * as the instance lives, with nothing logged. Callers that must not guess read
 * this instead and say so when it is absent.
 */
export function getLiveEngineSampleRate(): number | undefined {
    if (!isEngineAudioAvailable()) {
        return undefined;
    }
    return audioEngine.context.sampleRate;
}
