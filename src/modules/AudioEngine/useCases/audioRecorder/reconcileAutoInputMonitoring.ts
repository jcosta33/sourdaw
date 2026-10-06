import { getTrackEligibility, trackStore } from '#/modules/Arrangement/stores';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';

import { isTrackInputMonitored } from '../../repositories/audioRecorder/isTrackInputMonitored';

import { deriveAutoMonitorEdge } from './deriveAutoInputMonitoring';
import { startInputMonitoring } from './startInputMonitoring';
import { stopTrackInputMonitoring } from './stopTrackInputMonitoring';

type OpenRequest = { inputId: string | null; refused: boolean };

/**
 * Tracks this owner opened an edge for. A refused open stays recorded so a
 * denied microphone is not re-requested on every store publication; the entry
 * is dropped when the edge is next closed, so the next record or stop retries.
 */
const openRequests = new Map<string, OpenRequest>();

function closeEdge(trackId: string): void {
    openRequests.delete(trackId);
    stopTrackInputMonitoring(trackId);
}

function openEdge(trackId: string, inputId: string | null): void {
    const previous = openRequests.get(trackId);
    if (previous?.inputId === inputId && previous.refused) {
        return;
    }
    if (isTrackInputMonitored(trackId, inputId)) {
        return;
    }
    const request: OpenRequest = { inputId, refused: false };
    openRequests.set(trackId, request);
    void startInputMonitoring(trackId, inputId).then(
        (opened) => {
            request.refused = !opened;
        },
        () => {
            request.refused = true;
        }
    );
}

/**
 * The single owner of Auto input monitoring. Derives each Auto track's desired
 * edge from its arm state and the transport, and opens or closes it so that
 * repeating the call changes nothing. On and Off tracks belong to the user's
 * own gesture and are never touched. Every transition that feeds the
 * derivation — arm, mode change, record start/stop, play, stop — reaches this
 * through the track and transport stores, plus the explicit calls where a
 * rebuilt graph or a mode gesture needs the edge settled in the same turn.
 */
export function reconcileAutoInputMonitoring(): void {
    const tracks = trackStore.value?.tracks ?? [];
    const transport = transportStore.value ?? defaultTransportState;
    const presentIds = new Set<string>();

    for (const track of tracks) {
        presentIds.add(track.id);
        const eligible = getTrackEligibility(track.kind).acceptsMonitoring;
        const edge = deriveAutoMonitorEdge({
            inputMonitoring: eligible ? track.inputMonitoring : 'off',
            armed: track.armed,
            isPlaying: transport.isPlaying,
            isRecording: transport.isRecording,
        });
        if (edge === 'open') {
            openEdge(track.id, track.inputId);
        } else if (edge === 'closed') {
            closeEdge(track.id);
        } else {
            openRequests.delete(track.id);
        }
    }

    for (const trackId of [...openRequests.keys()]) {
        if (!presentIds.has(trackId)) {
            closeEdge(trackId);
        }
    }
}
