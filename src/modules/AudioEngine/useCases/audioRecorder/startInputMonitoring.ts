import { getTrackEligibility, trackStore } from '#/modules/Arrangement/stores';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';

import { isAutoInputMonitoringHeld } from '../../services/autoInputMonitoringSuspension';
import { readCommittedInputMonitoringTrack } from '../../stores/inputMonitoringProjectAccess';
import { getSelectedInputId } from '../audioDeviceSelection/getSelectedInputId';

import { admitInputMonitoring } from './admitInputMonitoring';
import { deriveAutoMonitorEdge } from './deriveAutoInputMonitoring';

export function startInputMonitoring(trackId: string, inputId?: string | null): Promise<boolean> {
    const selectedInputId = inputId === undefined ? getSelectedInputId() : inputId;
    const readIntent = (): { inputId: string | null; canAttach?: boolean } | null => {
        const projected = trackStore.value?.tracks.find((track) => track.id === trackId);
        const track = projected ?? readCommittedInputMonitoringTrack(trackId);
        if (!track) {
            return null;
        }
        // A committed eligible owner survives optimistic absence without recreating its strip.
        const canAttach = projected !== undefined;
        if (!getTrackEligibility(track.kind).acceptsMonitoring) {
            return null;
        }
        if (track.inputMonitoring === 'on') {
            return { inputId: track.inputId, canAttach };
        }
        if (track.kind !== 'audio') {
            return null;
        }
        const transport = transportStore.value ?? defaultTransportState;
        const edge = deriveAutoMonitorEdge({
            inputMonitoring: track.inputMonitoring,
            armed: track.armed,
            isPlaying: transport.isPlaying,
            isRecording: transport.isRecording,
        });
        if (edge !== 'open') {
            return null;
        }
        return { inputId: track.inputId, canAttach: canAttach && !isAutoInputMonitoringHeld() };
    };
    return admitInputMonitoring(trackId, selectedInputId, readIntent);
}
