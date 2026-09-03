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
        const initialRevision = captureProjectRevision();

        replaceCrdtDocInLineage({ id: 'root', doc: changedDoc });

        expect(automergeRepository.getDocumentIdentityEpoch()).toBe(initialIdentityEpoch);
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
});
