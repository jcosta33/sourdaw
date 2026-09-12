import { clampFaderGain } from '#/utils/audioLevelLaw';

import { audioEngine } from '../../repositories/createWebAudioEngine';
import { forwardMasterGainToNativeLiveGraphSession } from '../livePlayback/forwardMasterGainToNativeLiveGraphSession';

import { effectiveMasterGain, masterGainState } from './masterGainState';

/**
 * Move the master fader on every engine that is currently carrying a strip.
 *
 * The clamp happens here rather than only inside the Web Audio engine because
 * the clamped value is the one both carriers have to agree on: two engines
 * given different numbers for one fader is the split this exists to close.
 *
 * The fader's own position is what gets recorded, and the level the engines are
 * handed is that position through {@link effectiveMasterGain} — a comparison
 * trim is monitoring, so a gesture made while one is applied must move the
 * fader by what the musician asked for and not by what the trim leaves of it.
 *
 * Recording the level precedes the forward, because the forward reads it back on
 * the session's queue rather than carrying it.
 */
export function setMasterGainValue(value: number): void {
    masterGainState.gain = clampFaderGain(value);
    audioEngine.setMasterGain(effectiveMasterGain());
    forwardMasterGainToNativeLiveGraphSession();
}
