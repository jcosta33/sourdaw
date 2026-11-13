import { subscribeToActiveRootInstallations, subscribeToCrdtChanges } from '#/modules/CrdtDocument/useCases';

/** Wake the panel when raw ownership can change, including an equal-value root switch. */
export function subscribeToFermenterPatchOwner(listener: () => void): () => void {
    const unsubscribeRoot = subscribeToActiveRootInstallations(listener);
    const unsubscribeChanges = subscribeToCrdtChanges((docId) => {
        if (docId === undefined || docId === 'root') {
            listener();
        }
    });
    return () => {
        unsubscribeRoot();
        unsubscribeChanges();
    };
}
