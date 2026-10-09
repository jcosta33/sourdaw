import { sanitizeTrackSnapshot } from '#/modules/Arrangement/stores';
import { configureInputMonitoringProjectAccess } from '#/modules/AudioEngine/useCases';
import { DOC_PREFIX_ROOT, getCrdtDoc, subscribeToCrdtChanges } from '#/modules/CrdtDocument/useCases';

/** Bind fresh committed reads without subscribing or retaining a track projection at registration. */
export function initInputMonitoringProjectAccess(): void {
    configureInputMonitoringProjectAccess({
        hasTrack: (trackId) => {
            const document = getCrdtDoc(DOC_PREFIX_ROOT);
            // A missing registered root owns no tracks, including during project teardown.
            return (
                document !== undefined &&
                sanitizeTrackSnapshot(document.tracks).tracks.some((track) => track.id === trackId)
            );
        },
        readTrack: (trackId) => {
            const document = getCrdtDoc(DOC_PREFIX_ROOT);
            if (!document) {
                return null;
            }
            const track = sanitizeTrackSnapshot(document.tracks).tracks.find((candidate) => candidate.id === trackId);
            return track ? { inputMonitoring: track.inputMonitoring, inputId: track.inputId } : null;
        },
        subscribe: (listener) =>
            subscribeToCrdtChanges((docId) => {
                if (docId === undefined || docId === DOC_PREFIX_ROOT) {
                    listener();
                }
            }),
    });
}
