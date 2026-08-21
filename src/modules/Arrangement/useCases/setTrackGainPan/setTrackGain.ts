import { setTrackGain as engineSetTrackGain, updateDeviceParam } from '#/modules/AudioEngine/useCases';
import { recordAutomationValue } from '#/modules/Automation/useCases';
import { transportStore } from '#/modules/Transport/stores';
import { clampFaderGain } from '#/utils/audioLevelLaw';

import { getTrackById } from '../../repositories/track/getTrackById';
import { updateTrack } from '../../repositories/track/updateTrack';
import { getAllTracks } from '../getAllTracks';

import { getTrackFaderCeiling } from './getTrackFaderCeiling';
import { syncToasterPadParam } from './helpers';
import { maybeRecordAutomation } from './maybeRecordAutomation';

/**
 * `isTransient` splits *persistence* from the gesture, not the gesture from the
 * recording.
 *
 * A transient sample skips the store and the Toaster pad mirror — project truth
 * belongs to the committed value — but it still records, because a fader ride
 * *is* the automation rather than a value that happens to land at the end of
 * one. Every DAW that records mixer moves records the ride and then offers to
 * thin it: Pro Tools writes "a series of very small steps" and ships Degree of
 * Thinning, Live warns about envelopes with many breakpoints "e.g., after
 * recording automation" and ships Simplify Envelope, REAPER ships point
 * reduction, Logic records "any controller movements" as nodes. This repo
 * already agrees — `recordAutomationValue` only buffers, and
 * `flushPendingPoints` runs the shared RDP on release so "a full-rate
 * fader/MIDI ride does not persist raw into project truth". Recording only the
 * committed endpoint left that thinning nothing to thin.
 *
 * The Toaster pad mirror is on the engine side of that split, not the
 * persistence side. `syncToasterPadParam` writes through `updateDeviceParam` —
 * "the single door every device-parameter write reaches the DSP through", whose
 * store-side twin is `persistDeviceParam` — and on a Toaster pad track the pad
 * gain sits in series with the strip gain on the same audio, because
 * `createWebAudioEngine` connects the pad output into the child track's
 * `gainNode`. Left behind the persistence guard, a drag ran at
 * `padGain x oldTrackGain` while the thumb was down and `padGain x newTrackGain`
 * the instant it lifted: an audible step on release, about 6 dB for a
 * 0.8 -> 0.4 move. Only `updateTrack` belongs inside the guard.
 *
 * That series relationship is also why the ceiling is not unconditionally
 * `FADER_MAX_GAIN`: on a pad-mirrored track the one written value lands on
 * both nodes, so {@link getTrackFaderCeiling} holds it at unity, inside the
 * range `pad.rs` honours, and keeps the two in the lockstep the mirror exists
 * to maintain. That same function is what bounds the mixer strip's fader
 * travel, so the control cannot ask for a value this writer refuses.
 */
export function setTrackGain(trackId: string, gain: number, isTransient = false): void {
    const clamped = Math.min(clampFaderGain(gain), getTrackFaderCeiling(trackId));
    engineSetTrackGain(trackId, clamped);
    syncToasterPadParam(trackId, 'volume', clamped, { updateDeviceParam, getAllTracks });

    if (!isTransient) {
        updateTrack(trackId, (time) => ({ ...time, gain: clamped }));
    }

    maybeRecordAutomation(
        { getTransportValue: () => transportStore.value, getTrackById, recordAutomationValue },
        trackId,
        'gain',
        clamped
    );
}
