import { audioEngine } from '../../repositories/createWebAudioEngine';

/**
 * The rate the live engine renders at, or `undefined` when there is no engine.
 *
 * `getAudioSampleRate` substitutes a plausible rate when no `AudioContext`
 * exists, which suits a meter drawing a frequency axis and ruins an activation:
 * a plugin activated on a substituted rate is detuned, and reports a latency
 * scaled by the same wrong number, for as long as the instance lives — with
 * nothing logged, because the substitution already happened before the seam
 * that refuses an unusable rate could see it.
 *
 * Callers that must not guess read this instead and say so when it is absent.
 */
export function getLiveEngineSampleRate(): number | undefined {
    return audioEngine.context?.sampleRate;
}
