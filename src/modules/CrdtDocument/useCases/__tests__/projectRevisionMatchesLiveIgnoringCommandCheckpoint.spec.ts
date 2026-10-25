import { change, clone, getHeads, hasHeads, merge, view } from '@automerge/automerge';
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

    it('rejects a prior revision after a musician-visible edit is restored to its captured value', () => {
        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.tempo = 120;
        });
        const committedRevision = captureProjectRevision();

        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.tempo = 128;
        });
        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.tempo = 120;
        });

        expect(projectRevisionMatchesLiveIgnoringCommandCheckpoint(committedRevision)).toBe(false);
    });

    it('rejects a prior revision after project truth gains and then loses a field', () => {
        const committedRevision = captureProjectRevision();

        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.tempo = 128;
        });
        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            delete doc.tempo;
        });

        expect(projectRevisionMatchesLiveIgnoringCommandCheckpoint(committedRevision)).toBe(false);
    });

    it('rejects a published root edit followed by an exact-head same-lineage restore', () => {
        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.tempo = 120;
        });
        const originalRoot = automergeRepository.getDoc<Record<string, unknown>>('root');
        if (!originalRoot) {
            throw new Error('Expected the root document');
        }
        const originalHeads = getHeads(originalRoot);
        const committedRevision = captureProjectRevision();
        const mutationEpoch = automergeRepository.getMutationEpoch();

        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.tempo = 128;
        });
        expect(automergeRepository.getHeads('root')).not.toEqual(originalHeads);

        automergeRepository.replaceDocInLineage('root', clone(originalRoot));

        expect(automergeRepository.getHeads('root')).toEqual(originalHeads);
        expect(automergeRepository.getDoc<Record<string, unknown>>('root')?.tempo).toBe(120);
        expect(automergeRepository.getMutationEpoch()).toBeGreaterThan(mutationEpoch);
        expect(projectRevisionMatchesLiveIgnoringCommandCheckpoint(committedRevision)).toBe(false);
        expect(projectRevisionMatchesLiveIgnoringCommandCheckpoint(captureProjectRevision())).toBe(true);
    });

    it('rejects a shared-handle historical view even when it retains the later edit in history', () => {
        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.tempo = 120;
        });
        const committedRevision = captureProjectRevision();
        const originalHeads = automergeRepository.getHeads('root');
        const mutationEpoch = automergeRepository.getMutationEpoch();
        if (!originalHeads) {
            throw new Error('Expected root heads');
        }

        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.tempo = 128;
        });
        const editedRoot = automergeRepository.getDoc<Record<string, unknown>>('root');
        if (!editedRoot) {
            throw new Error('Expected the edited root document');
        }
        const editedHeads = getHeads(editedRoot);
        const historicalView = view(editedRoot, originalHeads);
        expect(historicalView.tempo).toBe(120);

        automergeRepository.replaceDocInLineage('root', historicalView);

        expect(automergeRepository.getHeads('root')).toEqual(originalHeads);
        const installedView = automergeRepository.getDoc('root');
        if (!installedView) {
            throw new Error('Expected the historical view to be installed');
        }
        expect(hasHeads(installedView, editedHeads)).toBe(true);
        expect(automergeRepository.getMutationEpoch()).toBeGreaterThan(mutationEpoch);
        expect(projectRevisionMatchesLiveIgnoringCommandCheckpoint(committedRevision)).toBe(false);
    });

    it('rejects a root rewind even if a command checkpoint follows it', () => {
        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.tempo = 120;
        });
        const originalRoot = automergeRepository.getDoc<Record<string, unknown>>('root');
        if (!originalRoot) {
            throw new Error('Expected the root document');
        }
        const committedRevision = captureProjectRevision();

        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.tempo = 128;
        });
        automergeRepository.replaceDocInLineage('root', clone(originalRoot));
        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.commandBatchIdempotency = { records: [{ batchId: 'batch-after-rewind' }] };
        });

        expect(projectRevisionMatchesLiveIgnoringCommandCheckpoint(committedRevision)).toBe(false);
    });

    it('rejects a same-membership snapshot restore to earlier root heads', () => {
        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.tempo = 120;
        });
        const originalRootBytes = automergeRepository.saveDoc('root');
        if (!originalRootBytes) {
            throw new Error('Expected root bytes');
        }
        const originalHeads = automergeRepository.getHeads('root');
        const committedRevision = captureProjectRevision();
        const mutationEpoch = automergeRepository.getMutationEpoch();

        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.tempo = 128;
        });
        automergeRepository.restoreSnapshot(new Map([['root', { state: 'present', bytes: originalRootBytes }]]));

        expect(automergeRepository.getDocIds()).toEqual(['root']);
        expect(automergeRepository.getHeads('root')).toEqual(originalHeads);
        expect(automergeRepository.getMutationEpoch()).toBeGreaterThan(mutationEpoch);
        expect(projectRevisionMatchesLiveIgnoringCommandCheckpoint(committedRevision)).toBe(false);
    });

    it('rejects a child document rewind with unchanged membership and heads', () => {
        automergeRepository.createChildDoc('routing');
        automergeRepository.changeDoc('routing', (doc: Record<string, unknown>) => {
            doc.output = 'master';
        });
        const originalChild = automergeRepository.getDoc<Record<string, unknown>>('routing');
        if (!originalChild) {
            throw new Error('Expected the routing document');
        }
        const originalHeads = getHeads(originalChild);
        const committedRevision = captureProjectRevision();
        const mutationEpoch = automergeRepository.getMutationEpoch();

        automergeRepository.changeDoc('routing', (doc: Record<string, unknown>) => {
            doc.output = 'bus-a';
        });
        automergeRepository.replaceDocInLineage('routing', clone(originalChild));

        expect(automergeRepository.getDocIds()).toEqual(['root', 'routing']);
        expect(automergeRepository.getHeads('routing')).toEqual(originalHeads);
        expect(automergeRepository.getMutationEpoch()).toBeGreaterThan(mutationEpoch);
        expect(projectRevisionMatchesLiveIgnoringCommandCheckpoint(committedRevision)).toBe(false);
    });

    it('accepts a forward same-lineage checkpoint merge and a same-head no-op replacement', () => {
        const originalRoot = automergeRepository.getDoc<Record<string, unknown>>('root');
        if (!originalRoot) {
            throw new Error('Expected the root document');
        }
        const committedRevision = captureProjectRevision();
        const originalHeads = getHeads(originalRoot);
        const checkpoint = change(clone(originalRoot, { actor: '1111111111111111' }), (doc) => {
            doc.commandBatchIdempotency = { records: [{ batchId: 'batch-forward' }] };
        });

        automergeRepository.replaceDocInLineage('root', checkpoint);
        expect(automergeRepository.getHeads('root')).not.toEqual(originalHeads);
        expect(projectRevisionMatchesLiveIgnoringCommandCheckpoint(committedRevision)).toBe(true);

        const checkpointRevision = captureProjectRevision();
        automergeRepository.replaceDocInLineage('root', clone(checkpoint));
        expect(automergeRepository.getHeads('root')).toEqual(getHeads(checkpoint));
        expect(projectRevisionMatchesLiveIgnoringCommandCheckpoint(checkpointRevision)).toBe(true);
    });

    it('accepts a concurrent checkpoint merge when only one active branch descends from the captured head', () => {
        const base = automergeRepository.getDoc<Record<string, unknown>>('root');
        if (!base) {
            throw new Error('Expected the root document');
        }
        const local = change(clone(base, { actor: '1111111111111111' }), (doc) => {
            doc.commandBatchIdempotency = { records: [{ batchId: 'batch-local' }] };
        });
        const remote = change(clone(base, { actor: '2222222222222222' }), (doc) => {
            doc.commandBatchIdempotency = { records: [{ batchId: 'batch-remote' }] };
        });
        automergeRepository.replaceDocInLineage('root', local);
        const committedRevision = captureProjectRevision();
        const capturedHead = getHeads(local)[0];
        if (!capturedHead) {
            throw new Error('Expected the captured local change head');
        }
        expect(hasHeads(remote, [capturedHead])).toBe(false);
        const advancedLocal = change(local, (doc) => {
            doc.commandBatchIdempotency = { records: [{ batchId: 'batch-local-next' }] };
        });

        automergeRepository.replaceDocInLineage('root', merge(advancedLocal, remote));

        const mergedHeads = automergeRepository.getHeads('root');
        expect(mergedHeads).toHaveLength(2);
        expect(mergedHeads).not.toContain(capturedHead);
        expect(mergedHeads).toContain(getHeads(advancedLocal)[0]);
        expect(mergedHeads).toContain(getHeads(remote)[0]);
        expect(projectRevisionMatchesLiveIgnoringCommandCheckpoint(committedRevision)).toBe(true);
    });
});
