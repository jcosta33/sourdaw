import { trackStore } from '#/modules/Arrangement/stores';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';

import { isTrackInputMonitored } from '../../repositories/audioRecorder/isTrackInputMonitored';
import { readMonitorTeardownEpoch } from '../../repositories/audioRecorder/readMonitorTeardownEpoch';

import { deriveAutoMonitorEdge } from './deriveAutoInputMonitoring';
import { startInputMonitoring } from './startInputMonitoring';
import { stopTrackInputMonitoring } from './stopTrackInputMonitoring';

type OpenRequest = { inputId: string | null; refused: boolean };
type TransportFlags = { isPlaying: boolean; isRecording: boolean };

/**
 * Tracks this owner holds an edge for, whether it opened the edge or adopted
 * one the user's On mode had already made live. A refused open stays recorded
 * so a denied microphone is not re-requested on every store publication; the
 * refusal is forgiven when the edge is next closed and when the transport next
 * starts recording or comes to rest, so the next record or stop retries.
 */
const openRequests = new Map<string, OpenRequest>();

let previousTransport: TransportFlags = { isPlaying: false, isRecording: false };

let reconciledTeardownEpoch = readMonitorTeardownEpoch();

/**
 * A global teardown (a graph reset, a project load) releases every edge and
 * capture, so a record made before it describes nothing that still exists. A
 * project load also publishes its tracks in one batch, so the removed-track
 * sweep never sees the previous project's track absent; without this, a refusal
 * remembered for a track id and input in the old project would suppress the
 * open for the same pair in the new one.
 */
function forgetRecordsFromBeforeTeardown(): void {
    const epoch = readMonitorTeardownEpoch();
    if (epoch === reconciledTeardownEpoch) {
        return;
    }
    reconciledTeardownEpoch = epoch;
    openRequests.clear();
}

function forgiveRefusalsAtRecordStartOrStop(transport: TransportFlags): void {
    const recordStarted = transport.isRecording && !previousTransport.isRecording;
    const cameToRest = previousTransport.isPlaying && !transport.isPlaying;
    previousTransport = { isPlaying: transport.isPlaying, isRecording: transport.isRecording };
    if (!recordStarted && !cameToRest) {
        return;
    }
    for (const [trackId, request] of openRequests) {
        if (request.refused) {
            openRequests.delete(trackId);
        }
    }
}

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
        // An edge the track already holds — one On opened, or this owner's own
        // open still in flight — is recorded so removing the track closes it.
        if (previous?.inputId !== inputId) {
            openRequests.set(trackId, { inputId, refused: false });
        }
        return;
    }
    const request: OpenRequest = { inputId, refused: false };
    openRequests.set(trackId, request);
    const teardownEpoch = readMonitorTeardownEpoch();
    // A graph reset releases every capture while a grant may still be pending,
    // and the orphaned grant then reports "not opened". That is the reset's
    // doing, not a refusal, so only a failure under the epoch the open began in
    // suppresses retries.
    const refusedBy = (opened: boolean): boolean => !opened && readMonitorTeardownEpoch() === teardownEpoch;
    void startInputMonitoring(trackId, inputId).then(
        (opened) => {
            request.refused = refusedBy(opened);
        },
        () => {
            request.refused = refusedBy(false);
        }
    );
}

/**
 * The single owner of Auto input monitoring. Derives each Auto track's desired
 * edge from its arm state and the transport, and opens or closes it so that
 * repeating the call changes nothing. Only audio tracks open an edge: the
 * microphone belongs to the kinds recording admission captures audio for. On
 * and Off tracks belong to the user's own gesture and are never touched, except
 * that an edge this owner held is released when its track turns Off. Every
 * transition that feeds the derivation — arm, mode change, record start/stop,
 * play, stop — reaches this through the track and transport stores, plus the
 * explicit calls where a rebuilt graph or a mode gesture needs the edge settled
 * in the same turn.
 */
export function reconcileAutoInputMonitoring(): void {
    const tracks = trackStore.value?.tracks ?? [];
    const transport = transportStore.value ?? defaultTransportState;
    const presentIds = new Set<string>();
    forgetRecordsFromBeforeTeardown();
    forgiveRefusalsAtRecordStartOrStop(transport);

    for (const track of tracks) {
        presentIds.add(track.id);
        if (track.kind !== 'audio') {
            continue;
        }
        const edge = deriveAutoMonitorEdge({
            inputMonitoring: track.inputMonitoring,
            armed: track.armed,
            isPlaying: transport.isPlaying,
            isRecording: transport.isRecording,
        });
        if (edge === 'open') {
            openEdge(track.id, track.inputId);
        } else if (edge === 'closed') {
            closeEdge(track.id);
        } else if (track.inputMonitoring === 'off' && openRequests.has(track.id)) {
            // A store-only write (a restored version, a collaborator) can turn
            // an Auto track Off without a gesture that stops its edge, also
            // after passing through On.
            closeEdge(track.id);
        } else if (track.inputMonitoring === 'on' && openRequests.get(track.id)?.refused) {
            // On keeps whatever edge this owner holds, so a later Off can still
            // release it. Only a refusal is forgiven: the user now asks for input.
            openRequests.delete(track.id);
        }
    }

    for (const trackId of [...openRequests.keys()]) {
        if (!presentIds.has(trackId)) {
            closeEdge(trackId);
        }
    }
}
