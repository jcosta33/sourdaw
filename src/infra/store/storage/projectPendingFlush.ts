import { reconcileCrdtSlot, type CrdtEntityIdentityByField, type CrdtSlotPresence } from './reconcileCrdtSlot';

type ProjectPendingFlushInput<TData> = {
    key: string;
    /** The write's base (null when unknown), its pending value and the decoded document authority. */
    baseValue: TData | null;
    pendingValue: TData & object;
    authorityValue: TData & object;
    /** False when the flush does not run the ordinary reconcile over one slot value. */
    replayable: boolean;
    /** The slot's durable fields, the ones its flush writes. */
    toDurable: (value: TData) => Partial<TData>;
    identityByField: CrdtEntityIdentityByField | undefined;
    documentPresence: CrdtSlotPresence | undefined;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The value a pending write leaves once its flush lands over the document's
 * current authority (issue 7454): the flush's own three-way reconcile against
 * the base the write was computed from, run on a detached copy of the decoded
 * authority. Whatever the write did not change keeps the document's value, a
 * peer's add and its removal included. A node both sides changed takes the
 * pending write's value, the rule the flush itself applies: the pending write
 * is this replica's newest intent, made after a peer change it had not seen,
 * and the store must show what the document will hold rather than a value the
 * flush then contradicts.
 *
 * Null when the flush cannot be replayed here: an unknown base, a slot whose
 * mutation hook owns its encoding, or several slot values whose conflict the
 * flush resolves across values it never sees.
 *
 * The merge runs on decoded values, not raw slot bytes, so the result is the
 * undecoded combination of two edits. A combination the store's inbound
 * sanitizer rejects therefore still reaches the caller's guard unsanitized,
 * and the caller treats the write as one it cannot replay. Fields outside the
 * durable set are runtime state and come from the document, as the field
 * rebase does.
 */
export function projectPendingFlush<TData>(input: ProjectPendingFlushInput<TData>): TData | null {
    const { key, baseValue, pendingValue, authorityValue, toDurable } = input;
    if (!input.replayable || baseValue === null || typeof baseValue !== 'object') {
        return null;
    }
    const durableAuthority = toDurable(authorityValue);
    const slotCopy: Record<string, unknown> = { [key]: structuredClone(durableAuthority) };
    reconcileCrdtSlot({
        doc: slotCopy,
        key,
        baseValue: toDurable(baseValue),
        value: structuredClone(toDurable(pendingValue)),
        identityByField: input.identityByField,
        documentPresence: input.documentPresence,
    });
    const merged = slotCopy[key];
    if (!isRecord(merged)) {
        return null;
    }
    const durableFields = new Set([...Object.keys(toDurable(pendingValue)), ...Object.keys(durableAuthority)]);
    const removedFields: Record<string, undefined> = {};
    for (const field of durableFields) {
        if (!Object.hasOwn(merged, field)) {
            removedFields[field] = undefined;
        }
    }
    return { ...pendingValue, ...authorityValue, ...removedFields, ...merged };
}
