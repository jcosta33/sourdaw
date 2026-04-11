import { getTrackById } from '../../repositories/track/getTrackById';
import { updateTrack } from '../../repositories/track/updateTrack';
import { getTransportState } from '#/modules/Transport/useCases';
import { getAllTracks } from '#/modules/Arrangement/useCases/getAllTracks';
import { recordAutomationValue } from '#/modules/Automation';
import { setTrackPan as engineSetTrackPan, updateDeviceParam } from '#/modules/AudioEngine/useCases';
import { maybeRecordAutomation, syncToasterPadParam } from './helpers';

export function setTrackPan(trackId: string, pan: number): void {
    const clamped = Math.max(-50, Math.min(50, pan));
    updateTrack(trackId, (t) => ({ ...t, pan: clamped }));
    engineSetTrackPan(trackId, clamped);
    syncToasterPadParam(trackId, 'pan', clamped / 50, { updateDeviceParam, getAllTracks });
    maybeRecordAutomation({ getTransportState, getTrackById, recordAutomationValue }, trackId, 'pan', clamped);
}