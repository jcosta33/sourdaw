import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { automergeRepository } from '../../repositories/automergeRepository';
import { captureDurableDocumentWitness } from '../captureDurableDocumentWitness';

describe('captureDurableDocumentWitness', () => {
    beforeEach(() => {
        automergeRepository.reset();
        automergeRepository.createProject('witness test');
    });

    afterEach(() => {
        automergeRepository.reset();
    });

    it('stays equal for the same document heads', () => {
        const initialWitness = captureDurableDocumentWitness();

        expect(captureDurableDocumentWitness()).toBe(initialWitness);
    });

    it('changes after a document mutation', () => {
        const initialWitness = captureDurableDocumentWitness();

        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.tempo = 128;
        });

        expect(captureDurableDocumentWitness()).not.toBe(initialWitness);
    });

    it('carries no session-local epoch fields, unlike captureProjectRevision', () => {
        const parsed: unknown = JSON.parse(captureDurableDocumentWitness());

        expect(parsed).not.toHaveProperty('documentIdentityEpoch');
        expect(parsed).not.toHaveProperty('mutationEpoch');
        expect(parsed).toHaveProperty('documents');
        expect(Object.keys(parsed as Record<string, unknown>)).toEqual(['documents']);
    });
});
