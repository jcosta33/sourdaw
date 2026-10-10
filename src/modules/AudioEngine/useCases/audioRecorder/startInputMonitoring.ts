import { getTrackEligibility, trackStore } from '#/modules/Arrangement/stores';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';

import { isAutoInputMonitoringHeld } from '../../services/autoInputMonitoringSuspension';
import { readCommittedInputMonitoringTrack } from '../../stores/inputMonitoringProjectAccess';
import { getSelectedInputId } from '../audioDeviceSelection/getSelectedInputId';

import { admitInputMonitoring } from './admitInputMonitoring';
import { deriveAutoMonitorEdge } from './deriveAutoInputMonitoring';
import { type ReadIntent } from './inputMonitoringAdmission';

export function startInputMonitoring(trackId: string, inputId?: string | null): Promise<boolean> {
    const selectedInputId = inputId === undefined ? getSelectedInputId() : inputId;
    const hadCommittedTrack = readCommittedInputMonitoringTrack(trackId) !== null;
    let followsCommittedTrack = false;
    const readIntent: ReadIntent = () => {
        const projected = trackStore.value?.tracks.find((track) => track.id === trackId);
        const committed = readCommittedInputMonitoringTrack(trackId);
        // An uncommitted On gesture may outlive its projection, but not its committed owner.
        if (hadCommittedTrack && !committed) {
            return null;
        }
        // A gesture can admit On before its write commits. Once committed truth
        // owns that admission, optimistic restore publications cannot revoke it.
        if (
            committed &&
            (!projected ||
                (committed.inputMonitoring === projected.inputMonitoring &&
                    committed.inputId === projected.inputId &&
                    committed.kind === projected.kind &&
                    committed.armed === projected.armed))
        ) {
            followsCommittedTrack = true;
        }
        const track = followsCommittedTrack ? committed : (projected ?? committed);
        if (!track) {
            return null;
        }
        // A committed eligible owner survives optimistic absence without recreating its strip.
        const canAttach = projected !== undefined;
        if (!getTrackEligibility(track.kind).acceptsMonitoring) {
            return null;
        }
        if (track.inputMonitoring === 'on') {
            return { inputId: track.inputId, inputMonitoring: 'on', canAttach };
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
        return {
            inputId: track.inputId,
            inputMonitoring: 'auto',
            canAttach: canAttach && !isAutoInputMonitoringHeld(),
        };
    };
    return admitInputMonitoring(trackId, selectedInputId, readIntent);
}
