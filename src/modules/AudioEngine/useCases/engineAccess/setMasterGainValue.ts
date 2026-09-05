import { clampFaderGain } from '#/utils/audioLevelLaw';

import { audioEngine } from '../../repositories/createWebAudioEngine';
import { forwardMasterGainToNativeLiveGraphSession } from '../livePlayback/forwardMasterGainToNativeLiveGraphSession';

import { masterGainState } from './masterGainState';

/**
 * Move the master fader on every engine that is currently carrying a strip.
 *
 * The clamp happens here rather than only inside the Web Audio engine because
 * the clamped value is the one both carriers have to agree on: two engines
 * given different numbers for one fader is the split this exists to close.
 */
export function setMasterGainValue(value: number): void {
    const gain = clampFaderGain(value);
    masterGainState.gain = gain;
    audioEngine.setMasterGain(gain);
    forwardMasterGainToNativeLiveGraphSession(gain);
}
