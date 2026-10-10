import {
    captureProjectRootIdentity,
    DOC_PREFIX_ROOT,
    getCrdtDoc,
    subscribeToCrdtChanges,
} from '#/modules/CrdtDocument/useCases';

import { sanitizeTrackSnapshot, trackStore } from '../stores/trackStore';

/** Direct removals share Command's committed-absence fence without changing their history route. */
export function finalizeCommittedTrackRuntimeRemoval(trackId: string, finalizeRuntimeRemoval: () => void): void {
    const document = getCrdtDoc(DOC_PREFIX_ROOT);
    if (!document || !sanitizeTrackSnapshot(document.tracks).tracks.some((track) => track.id === trackId)) {
        finalizeRuntimeRemoval();
        return;
    }
    const rootIdentity = captureProjectRootIdentity();
    let retired = false;
    let unsubscribeProject: () => void = () => undefined;
    let unsubscribeTracks: () => void = () => undefined;
    const retire = (): void => {
        retired = true;
        unsubscribeProject();
        unsubscribeTracks();
    };
    const settle = (): void => {
        if (retired) {
            return;
        }
        const current = getCrdtDoc(DOC_PREFIX_ROOT);
        if (!current || captureProjectRootIdentity() !== rootIdentity) {
            retire();
            return;
        }
        if (!sanitizeTrackSnapshot(current.tracks).tracks.some((track) => track.id === trackId)) {
            retire();
            finalizeRuntimeRemoval();
            return;
        }
        // Abort republishes the committed row. This removal then owns no future cleanup.
        if (trackStore.value?.tracks.some((track) => track.id === trackId)) {
            retire();
        }
    };
    unsubscribeProject = subscribeToCrdtChanges((docId) => {
        if (docId === undefined || docId === DOC_PREFIX_ROOT) {
            settle();
        }
    });
    unsubscribeTracks = trackStore.subscribe(settle);
}
