import { setTrackGain as engineSetTrackGain } from '#/modules/AudioEngine/useCases';
import { recordAutomationValue } from '#/modules/Automation/useCases';
import { transportStore } from '#/modules/Transport/stores';

import { getTrackById } from '../../repositories/track/getTrackById';
import { updateTrack } from '../../repositories/track/updateTrack';

import { clampTrackGain } from './clampTrackGain';
import { maybeRecordAutomation } from './maybeRecordAutomation';

/**
 * `isTransient` splits *persistence* from the gesture, not the gesture from the
 * recording.
 *
 * A transient sample skips the store — project truth belongs to the committed
 * value — but it still records, because a fader ride *is* the automation rather
 * than a value that happens to land at the end of one. Every DAW that records
 * mixer moves records the ride and then offers to thin it: Pro Tools writes "a
 * series of very small steps" and ships Degree of Thinning, Live warns about
 * envelopes with many breakpoints "e.g., after recording automation" and ships
 * Simplify Envelope, REAPER ships point reduction, Logic records "any
 * controller movements" as nodes. This repo already agrees —
 * `recordAutomationValue` only buffers, and `flushPendingPoints` runs the
 * shared RDP on release so "a full-rate fader/MIDI ride does not persist raw
 * into project truth". Recording only the committed endpoint left that
 * thinning nothing to thin.
 *
 * The fader drives only the strip's gain. A Toaster pad child keeps its pad
 * level where it belongs — the kit's own `volume`, owned by the Toaster panel
 * — because the pad output feeds this strip (`createWebAudioEngine` connects
 * it into the child track's `gainNode`), so the two are gain stages in series
 * and any mirror between them applies every move twice.
 */
export function setTrackGain(trackId: string, gain: number, isTransient = false): void {
    const clamped = clampTrackGain(gain);
    engineSetTrackGain(trackId, clamped);

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
