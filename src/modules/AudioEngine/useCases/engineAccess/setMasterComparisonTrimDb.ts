import { dbToGain, FADER_MAX_GAIN, gainToDb } from '#/utils/audioLevelLaw';

import { audioEngine } from '../../repositories/createWebAudioEngine';
import { forwardMasterGainToNativeLiveGraphSession } from '../livePlayback/forwardMasterGainToNativeLiveGraphSession';

import { effectiveMasterGain, masterGainState } from './masterGainState';

export type MasterComparisonTrim = {
    /** The offset the fader's remaining headroom actually delivered, in decibels. */
    appliedDb: number;
    /** Whether the fader ceiling clipped the requested offset. */
    limited: boolean;
};

/**
 * Offset the monitored master level without moving the fader.
 *
 * The caller asks for decibels rather than a multiplier because that is what a
 * loudness match is: the difference between two readings. What comes back is
 * what the output can actually deliver — a fader already near its ceiling has
 * no room left for make-up gain, and a comparison told it applied +6 dB when
 * the output rose by 2 dB would report a level match it never made.
 */
export function setMasterComparisonTrimDb(db: number): MasterComparisonTrim {
    masterGainState.comparisonTrim = dbToGain(db);
    const effective = effectiveMasterGain();
    audioEngine.setMasterGain(effective);
    forwardMasterGainToNativeLiveGraphSession();

    const { gain, comparisonTrim } = masterGainState;
    if (gain <= 0) {
        // A silent fader delivers no decibels of anything, and no offset can
        // push it past the ceiling, so there is nothing to report either way.
        return { appliedDb: 0, limited: false };
    }
    return { appliedDb: gainToDb(effective / gain), limited: gain * comparisonTrim > FADER_MAX_GAIN };
}
