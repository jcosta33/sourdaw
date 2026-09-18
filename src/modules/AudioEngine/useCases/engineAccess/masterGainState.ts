/**
 * Where the master fader stands, as the clamped linear amplitude the engines
 * were last told to use.
 *
 * Module state rather than a store read, because the fader's owner is another
 * module: Transport holds the position as project truth and calls into this one
 * to realise it. AudioEngine cannot read the Transport store — Transport
 * already imports these use cases, and the reverse edge would be a cycle — so
 * the value it applied is the only reading of the fader it is allowed to have.
 *
 * Seeded with `createWebAudioEngine`'s own default, so a session started before
 * the fader is ever moved states the level the Web Audio strips are already
 * playing at rather than unity.
 *
 * `comparisonTrim` is a second, independent multiplier: the monitoring offset a
 * loudness-matched A/B puts on the output so the two sides are judged at the
 * same level rather than by which one is louder. It is deliberately not the
 * fader — nothing writes it into project truth, and `gain` keeps stating the
 * position the fader is actually standing at — because a level match is a
 * property of the comparison, not of the mix.
 */

import { clampFaderGain } from '#/utils/audioLevelLaw';

export const masterGainState: { gain: number; comparisonTrim: number } = { gain: 0.8, comparisonTrim: 1 };

/**
 * The level both carriers are actually asked to play at: the fader's position
 * folded with the comparison trim, under the fader's own ceiling.
 *
 * Every writer of the master level states this rather than `gain`, because a
 * carrier given the bare fader position while another is given the trimmed one
 * is the split the fader's single-number contract exists to close.
 */
export function effectiveMasterGain(): number {
    return clampFaderGain(masterGainState.gain * masterGainState.comparisonTrim);
}
