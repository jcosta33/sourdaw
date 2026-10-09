import { getTrackEligibility, trackStore } from '#/modules/Arrangement/stores';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';

import { getSelectedInputId } from '../audioDeviceSelection/getSelectedInputId';

import { admitInputMonitoring } from './admitInputMonitoring';
import { deriveAutoMonitorEdge } from './deriveAutoInputMonitoring';

export function startInputMonitoring(trackId: string, inputId?: string | null): Promise<boolean> {
    const selectedInputId = inputId === undefined ? getSelectedInputId() : inputId;
    const readIntent = (): { inputId: string | null } | null => {
        const track = trackStore.value?.tracks.find((track) => track.id === trackId);
        if (!track || !getTrackEligibility(track.kind).acceptsMonitoring) {
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
