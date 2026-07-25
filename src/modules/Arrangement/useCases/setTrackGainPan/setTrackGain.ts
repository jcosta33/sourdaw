import { setTrackGain as engineSetTrackGain, updateDeviceParam } from '#/modules/AudioEngine/useCases';
import { recordAutomationValue } from '#/modules/Automation/useCases';
import { transportStore } from '#/modules/Transport/stores';
import { clampFaderGain } from '#/utils/audioLevelLaw';

import { getTrackById } from '../../repositories/track/getTrackById';
import { updateTrack } from '../../repositories/track/updateTrack';
import { getAllTracks } from '../getAllTracks';

import { syncToasterPadParam } from './helpers';
import { maybeRecordAutomation } from './maybeRecordAutomation';

export function setTrackGain(trackId: string, gain: number, isTransient = false): void {
    const clamped = clampFaderGain(gain);
    engineSetTrackGain(trackId, clamped);

    if (!isTransient) {
        updateTrack(trackId, (time) => ({ ...time, gain: clamped }));
        syncToasterPadParam(trackId, 'volume', clamped, { updateDeviceParam, getAllTracks });
        maybeRecordAutomation(
            { getTransportValue: () => transportStore.value, getTrackById, recordAutomationValue },
            trackId,
            'gain',
            clamped
        );
    }
}
