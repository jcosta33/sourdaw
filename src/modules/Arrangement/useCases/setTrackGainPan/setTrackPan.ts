import { setTrackPan as engineSetTrackPan, updateDeviceParam } from '#/modules/AudioEngine/useCases';
import { recordAutomationValue } from '#/modules/Automation/useCases';
import { transportStore } from '#/modules/Transport/stores';

import { getTrackById } from '../../repositories/track/getTrackById';
import { updateTrack } from '../../repositories/track/updateTrack';
import { getAllTracks } from '../getAllTracks';

import { syncToasterPadParam } from './helpers';
import { maybeRecordAutomation } from './maybeRecordAutomation';

/**
 * `isTransient` skips persistence, not recording — see `setTrackGain` for why a
 * ride has to reach the automation lane sample by sample while project truth
 * waits for the committed value.
 */
export function setTrackPan(trackId: string, pan: number, isTransient = false): void {
    const clamped = Math.max(-50, Math.min(50, pan));
    engineSetTrackPan(trackId, clamped);

    if (!isTransient) {
        updateTrack(trackId, (time) => ({ ...time, pan: clamped }));
        syncToasterPadParam(trackId, 'pan', clamped / 50, { updateDeviceParam, getAllTracks });
    }

    maybeRecordAutomation(
        { getTransportValue: () => transportStore.value, getTrackById, recordAutomationValue },
        trackId,
        'pan',
        clamped
    );
}
