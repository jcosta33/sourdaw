import { reconcileCrdtSlot, type CrdtSlotPresence } from './reconcileCrdtSlot';

export type CanonicalStorageSlotMutation = {
    readonly kind: 'canonical-json-slot-v1';
    readonly key: string;
    readonly baseValue: unknown;
    readonly value: unknown;
    readonly documentPresence?: CrdtSlotPresence;
};

/** The default single-slot callback, including retirement of inherited publication evidence. */
export function applyCanonicalStorageSlotMutation(
    doc: Record<string, unknown>,
    mutation: CanonicalStorageSlotMutation
): void {
    const evidenceKey = '_storagePublicationEvidence';
    const observesEvidence = Object.hasOwn(doc, evidenceKey);
    let before: string | undefined;
    if (observesEvidence) {
        before = JSON.stringify({ present: Object.hasOwn(doc, mutation.key), value: doc[mutation.key] });
    }
    reconcileCrdtSlot({ doc, ...mutation });
    if (
        observesEvidence &&
        before !== JSON.stringify({ present: Object.hasOwn(doc, mutation.key), value: doc[mutation.key] })
    ) {
        if (mutation.key === evidenceKey) {
            throw new Error('Publication metadata overlaps an action-owned document slot');
        }
        delete doc[evidenceKey];
    }
}
