import { change, clone, from, getActorId, getHeads, view, type Doc } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { canonicalJson } from '#/utils/canonicalDigest';

import {
    appendAutomergeStoragePublicationMetadata,
    AUTOMERGE_STORAGE_PUBLICATION_EVIDENCE_KEY,
    AutomergeStorageTransactionCommittedError,
    AutomergeStorageTransactionValidationError,
    configureAutomergeStoragePort,
    createAutomergeStorage,
    runWithAutomergeStorageTransaction,
} from '../createAutomergeStorage';

type Marker = {
    id: string;
    originalBeat: number;
    warpedBeat: number;
    origin: string;
    confidence: number;
    locked: boolean;
    unexpected?: boolean;
};
type State = {
    enabled: boolean;
    markers: Marker[];
    stretchMode: string;
    originalTempo: number | null;
    unexpected?: boolean;
};
type Document = { state: State; other: { count: number }; [key: string]: unknown };
type Port = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;
const marker: Marker = {
    id: 'auto',
    originalBeat: 0.1,
    warpedBeat: 0.35,
    origin: 'transient-auto',
    confidence: 0.73,
    locked: true,
};
const initial: State = { enabled: true, markers: [], stretchMode: 'repitch', originalTempo: 120 };
const expected: State = { ...initial, markers: [marker, { ...marker, id: 'user', origin: 'user', originalBeat: 0.8 }] };

let document: Doc<Document>;
let corrupt: ((draft: Document) => void) | undefined;
let throwAfterPublication = false;
let beforePublicationFailure = false;
let order: string[];
let ordinary: ReturnType<typeof vi.fn<Port['mutateDoc']>>;
let validated: ReturnType<typeof vi.fn<NonNullable<Port['mutateDocValidated']>>>;

function install(withCapability = true): void {
    ordinary = vi.fn<Port['mutateDoc']>(({ changeFn, message }) => {
        document = change(document, { message }, changeFn);
    });
    validated = vi.fn<NonNullable<Port['mutateDocValidated']>>((input) => {
        const original = document;
        const candidate = change(
            clone(document, { actor: getActorId(document) }),
            { message: input.message },
            (draft) => {
                input.changeFn(draft);
                corrupt?.(draft);
            }
        );
        order.push('validate');
        input.validateDocument(candidate);
        order.push('before');
        input.beforePublication();
        if (beforePublicationFailure) throw new Error('before publication failed');
        if (document !== original) throw new Error('authority changed');
        document = candidate;
        input.onPublished();
        order.push('published');
        if (throwAfterPublication) throw new Error('observer after publication');
    });
    configureAutomergeStoragePort({
        getDoc: () => document,
        getDocHeads: () => getHeads(document),
        hasDoc: () => true,
        getSemanticMessage: () => 'Detect transients',
        mutateDoc: ordinary,
        ...(withCapability ? { mutateDocValidated: validated } : {}),
    });
}

function storage() {
    const value = createAutomergeStorage<State>('root', 'state');
    value.hydrate?.();
    return value;
}

beforeEach(() => {
    document = from<Document>({ state: initial, other: { count: 0 } });
    corrupt = undefined;
    throwAfterPublication = false;
    beforePublicationFailure = false;
    order = [];
    install();
});
afterEach(() => configureAutomergeStoragePort(null));

describe('validated storage capability', () => {
    it('selects the optional branch only when there is a document validator', () => {
        const value = storage();
        const ordinaryTransaction = runWithAutomergeStorageTransaction(undefined, () => value.set(expected));
        ordinaryTransaction.commit();
        expect(ordinary).toHaveBeenCalledOnce();
        expect(validated).not.toHaveBeenCalled();
        const next = { ...expected, originalTempo: 121 };
        const transaction = runWithAutomergeStorageTransaction(undefined, () => value.set(next));
        transaction.validateDocument('root', (candidate) =>
            canonicalJson(candidate.state) === canonicalJson(next) ? null : 'wrong state'
        );
        transaction.commit();
        expect(validated).toHaveBeenCalledOnce();
        expect(order).toEqual(['validate', 'before', 'published']);
        expect(document.state).toEqual(next);
    });

    it('retains draft validation for a legacy port without the optional capability', () => {
        install(false);
        const value = storage();
        const original = document;
        const transaction = runWithAutomergeStorageTransaction(undefined, () => value.set(expected));
        transaction.validateDocument('root', () => 'legacy rejected');
        expect(() => transaction.commit()).toThrow('legacy rejected');
        transaction.abort();
        expect(ordinary).toHaveBeenCalledOnce();
        expect(validated).not.toHaveBeenCalled();
        expect(document).toBe(original);
        expect(value.get()).toEqual(initial);
    });

    it.each([
        'extra state key',
        'extra marker key',
        'missing marker key',
        'id',
        'originalBeat',
        'warpedBeat',
        'origin',
        'confidence',
        'locked',
        'reorder',
        'extra row',
        'missing row',
    ])('rejects %s in the actual candidate before installation', (kind) => {
        const original = document;
        const heads = getHeads(document);
        const value = storage();
        corrupt = (draft) => {
            const row = draft.state.markers[0];
            if (!row) throw new Error('Expected reconciled marker');
            if (kind === 'extra state key') draft.state.unexpected = true;
            if (kind === 'extra marker key') row.unexpected = true;
            if (kind === 'missing marker key') Reflect.deleteProperty(row, 'confidence');
            if (kind === 'id') row.id = 'changed';
            if (kind === 'originalBeat') row.originalBeat = 0.10000000000000002;
            if (kind === 'warpedBeat') row.warpedBeat = 0.35000000000000003;
            if (kind === 'origin') row.origin = 'user';
            if (kind === 'confidence') row.confidence = 0.74;
            if (kind === 'locked') row.locked = false;
            if (kind === 'reorder') draft.state.markers = [{ ...expected.markers[1]! }, { ...expected.markers[0]! }];
            if (kind === 'extra row') draft.state.markers.push({ ...marker, id: 'extra' });
            if (kind === 'missing row') draft.state.markers.pop();
        };
        const transaction = runWithAutomergeStorageTransaction(undefined, () => value.set(expected));
        transaction.validateDocument('root', (candidate) =>
            canonicalJson(candidate.state) === canonicalJson(expected) ? null : 'prospective state refused'
        );
        expect(() => transaction.commit()).toThrow(AutomergeStorageTransactionValidationError);
        transaction.abort();
        expect(document).toBe(original);
        expect(getHeads(document)).toEqual(heads);
        expect(value.get()).toEqual(initial);
        expect(order).toEqual(['validate']);
        document = change(document, (draft) => {
            draft.other.count = 1;
        });
        expect(document.other.count).toBe(1);
    });

    it('keeps a post-install failure committed and refuses a pre-install failure as rollback', () => {
        const value = storage();
        beforePublicationFailure = true;
        const rejected = runWithAutomergeStorageTransaction(undefined, () => value.set(expected));
        rejected.validateDocument('root', () => null);
        expect(() => rejected.commit()).toThrow('before publication failed');
        rejected.abort();
        expect(document.state).toEqual(initial);
        expect(value.get()).toEqual(initial);
        beforePublicationFailure = false;
        throwAfterPublication = true;
        const committed = runWithAutomergeStorageTransaction(undefined, () => value.set(expected));
        committed.validateDocument('root', () => null);
        expect(() => committed.commit()).toThrow(AutomergeStorageTransactionCommittedError);
        committed.abort();
        expect(document.state).toEqual(expected);
        expect(value.get()).toEqual(expected);
    });

    it('preserves semantic message and complete owner metadata only on an actual accepted change', () => {
        const value = storage();
        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            value.set(expected);
            appendAutomergeStoragePublicationMetadata('root', { member: 'detect' });
        });
        transaction.validateDocument('root', (candidate) => {
            expect(candidate[AUTOMERGE_STORAGE_PUBLICATION_EVIDENCE_KEY]).toEqual([{ member: 'detect' }]);
            return null;
        });
        transaction.commit();
        const acceptedHeads = getHeads(document);
        expect(validated.mock.calls[0]?.[0].message).toBe('Detect transients');
        const refused = runWithAutomergeStorageTransaction(undefined, () => {
            value.set({ ...expected, enabled: false });
            appendAutomergeStoragePublicationMetadata('root', { member: 'refused' });
        });
        refused.validateDocument('root', () => 'refused');
        expect(() => refused.commit()).toThrow('refused');
        refused.abort();
        expect(getHeads(document)).toEqual(acceptedHeads);
        expect(view(document, acceptedHeads)[AUTOMERGE_STORAGE_PUBLICATION_EVIDENCE_KEY]).toEqual([
            { member: 'detect' },
        ]);
    });
    it('does not report success when a validated capability returns without installation acknowledgement', () => {
        const original = document;
        configureAutomergeStoragePort({
            getDoc: () => document,
            hasDoc: () => true,
            getSemanticMessage: () => undefined,
            mutateDoc: ordinary,
            mutateDocValidated: (input) => {
                const candidate = change(clone(document, { actor: getActorId(document) }), input.changeFn);
                input.validateDocument(candidate);
                input.beforePublication();
            },
        });
        const value = storage();
        const transaction = runWithAutomergeStorageTransaction(undefined, () => value.set(expected));
        transaction.validateDocument('root', () => null);
        expect(() => transaction.commit()).toThrow('did not acknowledge publication');
        transaction.abort();
        expect(document).toBe(original);
        expect(value.get()).toEqual(initial);
    });
});
