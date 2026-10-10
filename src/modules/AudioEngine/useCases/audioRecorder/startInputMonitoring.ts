import { getTrackEligibility, trackStore } from '#/modules/Arrangement/stores';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';

import { readCommittedInputMonitoringTrack } from '../../stores/inputMonitoringProjectAccess';
import { getSelectedInputId } from '../audioDeviceSelection/getSelectedInputId';

import { admitInputMonitoring } from './admitInputMonitoring';
import { deriveAutoMonitorEdge } from './deriveAutoInputMonitoring';

export function startInputMonitoring(trackId: string, inputId?: string | null): Promise<boolean> {
    const selectedInputId = inputId === undefined ? getSelectedInputId() : inputId;
    const readIntent = (): { inputId: string | null; canAttach?: boolean } | null => {
        const track = trackStore.value?.tracks.find((track) => track.id === trackId);
        if (!track) {
            const committed = readCommittedInputMonitoringTrack(trackId);
            // Committed On still owns the grant while a removal is optimistic.
            // Keep that owner without recreating a strip the projection removed.
            return committed?.inputMonitoring === 'on' ? { inputId: committed.inputId, canAttach: false } : null;
        }
        if (!getTrackEligibility(track.kind).acceptsMonitoring) {
            return null;
        }
        if (track.inputMonitoring === 'on') {
            return { inputId: track.inputId };
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
        return edge === 'open' ? { inputId: track.inputId } : null;
    };
    return admitInputMonitoring(trackId, selectedInputId, readIntent);
}
