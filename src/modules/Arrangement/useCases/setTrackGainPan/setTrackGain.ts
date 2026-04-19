import { getTrackById } from '../../repositories/track/getTrackById';
import { updateTrack } from '../../repositories/track/updateTrack';
import { getTransportState } from '#/modules/Transport/useCases';
import { getAllTracks } from '../getAllTracks';
import { recordAutomationValue } from '#/modules/Automation/useCases';
import { setTrackGain as engineSetTrackGain, updateDeviceParam } from '#/modules/AudioEngine/useCases';
import { maybeRecordAutomation, syncToasterPadParam } from './helpers';

export function setTrackGain(trackId: string, gain: number): void {
    const clamped = Math.max(0, Math.min(1, gain));
    updateTrack(trackId, (t) => ({ ...t, gain: clamped }));
    engineSetTrackGain(trackId, clamped);
    syncToasterPadParam(trackId, 'volume', clamped, { updateDeviceParam, getAllTracks });
    maybeRecordAutomation({ getTransportState, getTrackById, recordAutomationValue }, trackId, 'gain', clamped);
}