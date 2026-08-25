import { setTrackPan as engineSetTrackPan, updateDeviceParam } from '#/modules/AudioEngine/useCases';
import { recordAutomationValue } from '#/modules/Automation/useCases';
import { transportStore } from '#/modules/Transport/stores';

import { getTrackById } from '../../repositories/track/getTrackById';
import { updateTrack } from '../../repositories/track/updateTrack';
import { getAllTracks } from '../getAllTracks';

import { syncToasterPadParam } from './helpers';
import { maybeRecordAutomation } from './maybeRecordAutomation';

/**
 * Full-left to full-right on the track's own `pan` field. The automation lane is
 * normalised instead, so the two are not interchangeable — see below.
 */
const PAN_FIELD_FULL_SCALE = 50;

/**
 * `isTransient` skips persistence, not recording, and not the engine — see
 * `setTrackGain` for why a ride has to reach the automation lane sample by
 * sample while project truth waits for the committed value. The Toaster pad
 * pan mirror travels with the engine call rather than with the store write
 * for the same reason: a drag has to sound continuous while the thumb is
 * down, not step to the new pan the instant it lifts.
 *
 * **The lane is normalised; the track field is not.** `Track.pan` runs
 * -50..50, but every authority on the *lane* runs -1..1: `addAutomationLane`
 * gives a pan lane `minValue: -1`, `applyAutomation` multiplies the stored value
 * by 50 on its way to `scheduleTrackPan`, and the lane editor formats it as
 * `value * 100` with an L/R suffix. Recording the raw field into the lane made a
 * hard-L-to-hard-R sweep read back as ±2500, which `TrackNode` clamps to ±1 —
 * hard left until the zero crossing, hard right after, a square wave where a
 * sweep was performed. It also drew the curve 50x outside the editor's own grid
 * and left the RDP tolerance 50x too tight, so pan under-thinned by an order of
 * magnitude. The lane's units are the ones that cross the boundary.
 */
export function setTrackPan(trackId: string, pan: number, isTransient = false): void {
    const clamped = Math.max(-PAN_FIELD_FULL_SCALE, Math.min(PAN_FIELD_FULL_SCALE, pan));
    engineSetTrackPan(trackId, clamped);
    syncToasterPadParam(trackId, 'pan', clamped / PAN_FIELD_FULL_SCALE, { updateDeviceParam, getAllTracks });

    if (!isTransient) {
        updateTrack(trackId, (time) => ({ ...time, pan: clamped }));
    }

    maybeRecordAutomation(
        { getTransportValue: () => transportStore.value, getTrackById, recordAutomationValue },
        trackId,
        'pan',
        clamped / PAN_FIELD_FULL_SCALE
    );
}
