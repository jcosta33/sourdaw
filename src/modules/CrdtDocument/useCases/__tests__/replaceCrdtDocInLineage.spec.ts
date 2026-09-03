import { change } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { automergeRepository } from '../../repositories/automergeRepository';
import { captureProjectRevision } from '../captureProjectRevision';
import { replaceCrdtDocInLineage } from '../replaceCrdtDocInLineage';

describe('replaceCrdtDocInLineage', () => {
    beforeEach(() => {
        automergeRepository.reset();
        automergeRepository.createProject('lineage test');
    });

    afterEach(() => {
        vi.restoreAllMocks();
        automergeRepository.reset();
    });

    it('leaves the document identity epoch unchanged and moves the revision for an existing document', () => {
        const storedDoc = automergeRepository.getDoc<Record<string, unknown>>('root');
        if (!storedDoc) {
            throw new Error('Expected the root document to exist');
        }
        const changedDoc = change(storedDoc, (doc) => {
            doc.tempo = 128;
        });

        const initialIdentityEpoch = automergeRepository.getDocumentIdentityEpoch();
        const initialMutationEpoch = automergeRepository.getMutationEpoch();
        const initialRevision = captureProjectRevision();

        replaceCrdtDocInLineage({ id: 'root', doc: changedDoc });

        expect(automergeRepository.getDocumentIdentityEpoch()).toBe(initialIdentityEpoch);
        expect(automergeRepository.getMutationEpoch()).toBe(initialMutationEpoch + 1);
        expect(captureProjectRevision()).not.toBe(initialRevision);
    });

    it('notifies a registered listener exactly once', () => {
        const storedDoc = automergeRepository.getDoc<Record<string, unknown>>('root');
        if (!storedDoc) {
            throw new Error('Expected the root document to exist');
        }
        const changedDoc = change(storedDoc, (doc) => {
            doc.tempo = 128;
        });

        const listener = vi.fn();
        automergeRepository.onChange(listener);

        replaceCrdtDocInLineage({ id: 'root', doc: changedDoc });

        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledWith('root', undefined);
    });

    it('refuses a sync that overlaps a reserved snapshot transaction and admits an unrelated document', async () => {
        automergeRepository.createChildDoc('child');

        const storedRoot = automergeRepository.getDoc<Record<string, unknown>>('root');
        const storedChild = automergeRepository.getDoc<Record<string, unknown>>('child');
        if (!storedRoot || !storedChild) {
            throw new Error('Expected the root and child documents to exist');
        }
        const changedDoc = change(storedRoot, (doc) => {
            doc.tempo = 128;
        });
        const changedChildDoc = change(storedChild, (doc) => {
            doc.touched = true;
        });

        let transactionStarted!: () => void;
        let releaseTransaction!: () => void;
        const started = new Promise<void>((resolve) => {
            transactionStarted = resolve;
        });
        const release = new Promise<void>((resolve) => {
            releaseTransaction = resolve;
        });
        const pending = automergeRepository.transactSnapshot(async (transaction) => {
            automergeRepository.reserveSnapshotTransactionDocuments(transaction, ['root']);
            transactionStarted();
            await release;
        });
        await started;

        expect(() => replaceCrdtDocInLineage({ id: 'root', doc: changedDoc })).toThrow(
            'overlaps the active snapshot transaction'
        );
        expect(() => replaceCrdtDocInLineage({ id: 'child', doc: changedChildDoc })).not.toThrow();

        releaseTransaction();
        await pending;
    });
});
