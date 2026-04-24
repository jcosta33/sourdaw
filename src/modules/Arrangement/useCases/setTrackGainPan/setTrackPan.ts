import { setTrackPan as engineSetTrackPan, updateDeviceParam } from '#/modules/AudioEngine/useCases';
import { recordAutomationValue } from '#/modules/Automation/useCases';
import { transportStore } from '#/modules/Transport/stores';

import { getTrackById } from '../../repositories/track/getTrackById';
import { updateTrack } from '../../repositories/track/updateTrack';
import { getAllTracks } from '../getAllTracks';

import { maybeRecordAutomation, syncToasterPadParam } from './helpers';

export function setTrackPan(trackId: string, pan: number): void {
    const clamped = Math.max(-50, Math.min(50, pan));
    updateTrack(trackId, (t) => ({ ...t, pan: clamped }));
    engineSetTrackPan(trackId, clamped);
    syncToasterPadParam(trackId, 'pan', clamped / 50, { updateDeviceParam, getAllTracks });
    maybeRecordAutomation(
        { getTransportValue: () => transportStore.value, getTrackById, recordAutomationValue },
        trackId,
        'pan',
        clamped
    );
}
