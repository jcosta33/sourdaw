import { change, from, getHeads, view } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    appendAutomergeStoragePublicationMetadata,
    AUTOMERGE_STORAGE_PUBLICATION_EVIDENCE_KEY,
    configureAutomergeStoragePort,
    createAutomergeStorage,
    runWithAutomergeStorageTransaction,
} from '../createAutomergeStorage';

describe('owner-local publication metadata', () => {
    let document = from<Record<string, unknown>>({ state: { count: 0 }, other: { count: 0 } });
    let label = 'first label';
    let messages: Array<string | undefined> = [];
    beforeEach(() => {
        document = from({ state: { count: 0 }, other: { count: 0 } });
        label = 'first label';
        messages = [];
        configureAutomergeStoragePort({
            getDoc: () => document,
            hasDoc: () => true,
            getSemanticMessage: () => label,
            mutateDoc: ({ changeFn, message }) => {
                document = change(document, { message }, changeFn);
                messages.push(message);
            },
        });
    });
    afterEach(() => configureAutomergeStoragePort(null));

    function storage(key = 'state') {
        const value = createAutomergeStorage<{ count: number }>('root', key);
        value.hydrate?.();
        return value;
    }

    it('binds all members to one actual change while preserving its first message', () => {
        const value = storage();
        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            value.set({ count: 1 });
            appendAutomergeStoragePublicationMetadata('root', { member: 'first' });
            label = 'second label';
            appendAutomergeStoragePublicationMetadata('root', { member: 'second' });
            value.set({ count: 2 });
        });
        transaction.commit();
        const publication = getHeads(document);
        expect(messages).toEqual(['first label']);
        expect(document[AUTOMERGE_STORAGE_PUBLICATION_EVIDENCE_KEY]).toEqual([
            { member: 'first' },
            { member: 'second' },
        ]);
        const later = runWithAutomergeStorageTransaction(undefined, () => value.set({ count: 3 }));
        later.commit();
        expect(document[AUTOMERGE_STORAGE_PUBLICATION_EVIDENCE_KEY]).toBeUndefined();
        expect(view(document, publication)[AUTOMERGE_STORAGE_PUBLICATION_EVIDENCE_KEY]).toEqual([
            { member: 'first' },
            { member: 'second' },
        ]);
    });

    it('does not publish metadata alone, for absorbed writes, or for refused writes', () => {
        const value = storage();
        const heads = getHeads(document);
        const alone = runWithAutomergeStorageTransaction(undefined, () =>
            appendAutomergeStoragePublicationMetadata('root', { member: 'alone' })
        );
        alone.commit();
        const absorbed = runWithAutomergeStorageTransaction(undefined, () => {
            appendAutomergeStoragePublicationMetadata('root', { member: 'absorbed' });
            value.set({ count: 0 });
        });
        absorbed.commit();
        expect(getHeads(document)).toEqual(heads);
        const refused = runWithAutomergeStorageTransaction(undefined, () => {
            appendAutomergeStoragePublicationMetadata('root', { member: 'refused' });
            value.set({ count: 1 });
        });
        refused.validateDocument('root', () => 'source refused');
        expect(() => refused.commit()).toThrow('source refused');
        refused.abort();
        expect(getHeads(document)).toEqual(heads);
        expect(document[AUTOMERGE_STORAGE_PUBLICATION_EVIDENCE_KEY]).toBeUndefined();
    });

    it('keeps overlapping owners separate and refuses unowned metadata', () => {
        const first = storage();
        const second = storage('other');
        const left = runWithAutomergeStorageTransaction(undefined, () => {
            first.set({ count: 1 });
            appendAutomergeStoragePublicationMetadata('root', { member: 'left' });
        });
        const right = runWithAutomergeStorageTransaction(undefined, () => {
            second.set({ count: 1 });
            appendAutomergeStoragePublicationMetadata('root', { member: 'right' });
        });
        right.commit();
        expect(document[AUTOMERGE_STORAGE_PUBLICATION_EVIDENCE_KEY]).toEqual([{ member: 'right' }]);
        left.commit();
        expect(document[AUTOMERGE_STORAGE_PUBLICATION_EVIDENCE_KEY]).toEqual([{ member: 'left' }]);
        expect(() => appendAutomergeStoragePublicationMetadata('root', {})).toThrow('entered storage transaction');
    });
});
