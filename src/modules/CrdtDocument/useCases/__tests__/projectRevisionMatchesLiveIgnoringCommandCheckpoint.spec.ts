import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { automergeRepository } from '../../repositories/automergeRepository';
import { captureProjectRevision } from '../captureProjectRevision';
import { projectRevisionMatchesLiveIgnoringCommandCheckpoint } from '../projectRevisionMatchesLiveIgnoringCommandCheckpoint';

describe('projectRevisionMatchesLiveIgnoringCommandCheckpoint', () => {
    beforeEach(() => {
        automergeRepository.reset();
        automergeRepository.createProject('checkpoint revision test');
    });

    afterEach(() => {
        automergeRepository.reset();
    });

    it('accepts the live revision', () => {
        const revision = captureProjectRevision();
        expect(projectRevisionMatchesLiveIgnoringCommandCheckpoint(revision)).toBe(true);
    });

    it('accepts a prior revision after only the command-batch checkpoint is journaled', () => {
        const committedRevision = captureProjectRevision();

        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.commandBatchIdempotency = { records: [{ batchId: 'batch-1' }] };
        });

        expect(captureProjectRevision()).not.toBe(committedRevision);
        expect(projectRevisionMatchesLiveIgnoringCommandCheckpoint(committedRevision)).toBe(true);
    });

    it('rejects a prior revision after musician-visible project truth changes', () => {
        const committedRevision = captureProjectRevision();

        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.tempo = 128;
        });

        expect(projectRevisionMatchesLiveIgnoringCommandCheckpoint(committedRevision)).toBe(false);
    });
});
