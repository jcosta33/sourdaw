import { getTrackEligibility, trackStore } from '#/modules/Arrangement/stores';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { runAllEffects } from '#/utils/runEffects';

import { hasDeferredInputMonitoringEdge } from '../../repositories/audioRecorder/hasDeferredInputMonitoringEdge';
import { isTrackInputMonitored } from '../../repositories/audioRecorder/isTrackInputMonitored';
import { readInputMonitoringTrackIds } from '../../repositories/audioRecorder/readInputMonitoringTrackIds';
import { readMonitorTeardownEpoch } from '../../repositories/audioRecorder/readMonitorTeardownEpoch';
import { stopTrackInputMonitoring as stopTrackInputMonitoringRepo } from '../../repositories/audioRecorder/stopTrackInputMonitoring';
import { isAutoInputMonitoringHeld } from '../../services/autoInputMonitoringSuspension';
import { readCommittedInputMonitoringTrack } from '../../stores/inputMonitoringProjectAccess';

import { admitInputMonitoring } from './admitInputMonitoring';
import { deriveAutoMonitorEdge } from './deriveAutoInputMonitoring';
import { type Admission, inputMonitoringAdmissions } from './inputMonitoringAdmission';
import { readChangedInputMonitoringAdmission } from './readChangedInputMonitoringAdmission';
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

function retireCapture(trackId: string, admission: Admission): void {
    // Keep the original authority for row return, independently of the
    // obsolete grant's settlement, without holding capture or opening a strip.
    inputMonitoringAdmissions.set(trackId, { ...admission, captureRetired: true });
    openRequests.delete(trackId);
    stopTrackInputMonitoringRepo(trackId);
}

function closeInvalidAdmission(
    track: NonNullable<typeof trackStore.value>['tracks'][number],
    admission: Admission
): void {
    const committed = readCommittedInputMonitoringTrack(track.id);
    if (
        admission.captureRetired &&
        committed &&
        (committed.inputMonitoring !== track.inputMonitoring ||
            committed.inputId !== track.inputId ||
            committed.kind !== track.kind ||
            committed.armed !== track.armed)
    ) {
        // Abort may restore a stale Auto row. Its cancelled
        // authority still fences the projection-only fallback.
        retireCapture(track.id, admission);
        return;
    }
    closeEdge(track.id);
}

function followAdmittedOnInput(trackId: string, interestedIds: Set<string>, opensSuppressed: boolean): void {
    if (opensSuppressed || !interestedIds.has(trackId)) {
        return;
    }
    const changed = readChangedInputMonitoringAdmission(trackId);
    if (changed) {
        openEdge(trackId, changed.inputId, changed.readIntent);
    }
}

function reconcileNonAudioTrack(
    track: NonNullable<typeof trackStore.value>['tracks'][number],
    interestedIds: Set<string>,
    opensSuppressed: boolean
): void {
    if (
        (!getTrackEligibility(track.kind).acceptsMonitoring || track.inputMonitoring !== 'on') &&
        interestedIds.has(track.id)
    ) {
        closeEdge(track.id);
    } else if (track.inputMonitoring === 'on') {
        followAdmittedOnInput(track.id, interestedIds, opensSuppressed);
    }
}

function openEdge(
    trackId: string,
    inputId: string | null,
    readIntent?: Parameters<typeof admitInputMonitoring>[2]
): void {
    const previous = openRequests.get(trackId);
    if (previous?.inputId === inputId && previous.refused) {
        return;
    }
    if (isTrackInputMonitored(trackId, inputId) && !hasDeferredInputMonitoringEdge(trackId)) {
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
    let opening: Promise<boolean>;
    if (readIntent) {
        opening = admitInputMonitoring(trackId, inputId, readIntent);
    } else {
        opening = startInputMonitoring(trackId, inputId);
    }
    void opening.then(
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
 * repeating the call changes nothing. Only audio tracks open an Auto edge: the
 * microphone belongs to the kinds recording admission captures audio for. On
 * is admitted only by a gesture, recording or rearm; existing On interests
 * still follow store-only Off, eligibility and removal cleanup. Every
 * transition that feeds the derivation — arm, mode change, record start/stop,
 * play, stop — reaches this through the track and transport stores, plus the
 * explicit calls where a rebuilt graph or a mode gesture needs the edge settled
 * in the same turn. While a caller holds a suspension it still follows every
 * transition and closes every edge that should be closed, but opens none: a
 * transport state that caller publishes only in passing is never read as rest,
 * and the reconcile that releases the hold opens whatever should be open.
 */
export function reconcileAutoInputMonitoring(): void {
    const opensSuppressed = isAutoInputMonitoringHeld();
    const tracks = trackStore.value?.tracks ?? [];
    const transport = transportStore.value ?? defaultTransportState;
    const presentIds = new Set(tracks.map((track) => track.id));
    const interestedIds = new Set([
        ...openRequests.keys(),
        ...readInputMonitoringTrackIds(),
        ...inputMonitoringAdmissions.keys(),
    ]);
    forgiveRefusalsAtRecordStartOrStop(transport);

    const reconcileTrack = (track: (typeof tracks)[number]): void => {
        const admission = inputMonitoringAdmissions.get(track.id);
        if (admission) {
            // The admission reader follows committed eligibility once the
            // project owns it; a pending projection must not destroy capture.
            const intent = admission.readIntent();
            if (!intent) {
                closeInvalidAdmission(track, admission);
                return;
            }
            if (intent.inputMonitoring === 'auto') {
                if (!opensSuppressed) {
                    const inputId =
                        intent.inputId === admission.selectorInputId ? admission.captureInputId : intent.inputId;
                    openEdge(track.id, inputId, admission.readIntent);
                }
            } else {
                followAdmittedOnInput(track.id, interestedIds, opensSuppressed);
            }
            return;
        }
        if (track.kind !== 'audio') {
            reconcileNonAudioTrack(track, interestedIds, opensSuppressed);
            return;
        }
        const edge = deriveAutoMonitorEdge({
            inputMonitoring: track.inputMonitoring,
            armed: track.armed,
            isPlaying: transport.isPlaying,
            isRecording: transport.isRecording,
        });
        if (edge === 'open') {
            if (!opensSuppressed) {
                openEdge(track.id, track.inputId);
            }
        } else if (edge === 'closed') {
            closeEdge(track.id);
        } else if (track.inputMonitoring === 'off' && interestedIds.has(track.id)) {
            // A store-only write (a restored version, a collaborator) can turn
            // a track Off without the gesture that admitted its capture.
            closeEdge(track.id);
        } else if (track.inputMonitoring === 'on') {
            followAdmittedOnInput(track.id, interestedIds, opensSuppressed);
            if (!openRequests.get(track.id)?.refused) {
                return;
            }
            // On keeps whatever edge this owner holds, so a later Off can still
            // release it. Only a refusal is forgiven: the user now asks for input.
            openRequests.delete(track.id);
        }
    };

    // One refused disconnect must not strand another owner's terminal cleanup.
    runAllEffects([
        ...tracks.map((track) => () => reconcileTrack(track)),
        ...Array.from(interestedIds, (trackId) => () => {
            if (presentIds.has(trackId)) {
                return;
            }
            const admission = inputMonitoringAdmissions.get(trackId);
            if (admission) {
                const intent = admission.readIntent();
                if (!intent) {
                    if (readCommittedInputMonitoringTrack(trackId)) {
                        retireCapture(trackId, admission);
                    } else {
                        closeEdge(trackId);
                    }
                } else if (intent.inputId !== admission.selectorInputId) {
                    retireCapture(trackId, admission);
                }
                return;
            }
            const committed = readCommittedInputMonitoringTrack(trackId);
            if (committed && getTrackEligibility(committed.kind).acceptsMonitoring) {
                if (committed.inputMonitoring === 'on') {
                    return;
                }
                if (
                    committed.kind === 'audio' &&
                    deriveAutoMonitorEdge({
                        inputMonitoring: committed.inputMonitoring,
                        armed: committed.armed,
                        isPlaying: transport.isPlaying,
                        isRecording: transport.isRecording,
                    }) === 'open'
                ) {
                    return;
                }
            }
            closeEdge(trackId);
        }),
    ]);
}
