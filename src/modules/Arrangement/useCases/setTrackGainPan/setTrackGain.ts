import { setTrackGain as engineSetTrackGain, updateDeviceParam } from '#/modules/AudioEngine/useCases';
import { recordAutomationValue } from '#/modules/Automation/useCases';
import { transportStore } from '#/modules/Transport/stores';

import { getTrackById } from '../../repositories/track/getTrackById';
import { updateTrack } from '../../repositories/track/updateTrack';
import { getAllTracks } from '../getAllTracks';

import { maybeRecordAutomation, syncToasterPadParam } from './helpers';

export function setTrackGain(trackId: string, gain: number): void {
    const clamped = Math.max(0, Math.min(1, gain));
    updateTrack(trackId, (t) => ({ ...t, gain: clamped }));
    engineSetTrackGain(trackId, clamped);
    syncToasterPadParam(trackId, 'volume', clamped, { updateDeviceParam, getAllTracks });
    maybeRecordAutomation(
        { getTransportValue: () => transportStore.value, getTrackById, recordAutomationValue },
        trackId,
        'gain',
        clamped
    );
}
