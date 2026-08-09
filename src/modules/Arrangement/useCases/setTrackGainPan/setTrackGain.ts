import { setTrackGain as engineSetTrackGain, updateDeviceParam } from '#/modules/AudioEngine/useCases';
import { recordAutomationValue } from '#/modules/Automation/useCases';
import { transportStore } from '#/modules/Transport/stores';
import { clampFaderGain } from '#/utils/audioLevelLaw';

import { getTrackById } from '../../repositories/track/getTrackById';
import { updateTrack } from '../../repositories/track/updateTrack';
import { getAllTracks } from '../getAllTracks';

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
 */
export function setTrackGain(trackId: string, gain: number, isTransient = false): void {
    const clamped = clampFaderGain(gain);
    engineSetTrackGain(trackId, clamped);

    if (!isTransient) {
        updateTrack(trackId, (time) => ({ ...time, gain: clamped }));
        syncToasterPadParam(trackId, 'volume', clamped, { updateDeviceParam, getAllTracks });
    }

    maybeRecordAutomation(
        { getTransportValue: () => transportStore.value, getTrackById, recordAutomationValue },
        trackId,
        'gain',
        clamped
    );
}
