import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { automergeRepository } from '../../repositories/automergeRepository';
import { captureProjectRevision } from '../captureProjectRevision';

describe('captureProjectRevision', () => {
    beforeEach(() => {
        automergeRepository.reset();
        automergeRepository.createProject('revision test');
    });

    afterEach(() => {
        vi.restoreAllMocks();
        automergeRepository.reset();
    });

    it('stays stable until an active project document changes', () => {
        const initialRevision = captureProjectRevision();

        expect(captureProjectRevision()).toBe(initialRevision);

        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.tempo = 128;
        });

        expect(captureProjectRevision()).not.toBe(initialRevision);
    });

    it('changes when project document membership changes', () => {
        const initialRevision = captureProjectRevision();

        automergeRepository.createChildDoc('routing');

        expect(captureProjectRevision()).not.toBe(initialRevision);
    });

    it('changes when an existing child document changes', () => {
        automergeRepository.createChildDoc('routing');
        const initialRevision = captureProjectRevision();

        automergeRepository.changeDoc('routing', (doc: Record<string, unknown>) => {
            doc.output = 'bus-a';
        });

        expect(captureProjectRevision()).not.toBe(initialRevision);
    });

    it('canonicalizes document and head ordering', () => {
        vi.spyOn(automergeRepository, 'getDocumentIdentityEpoch').mockReturnValue(7);
        vi.spyOn(automergeRepository, 'getDocIds').mockReturnValue(['zeta', 'root', 'alpha']);
        vi.spyOn(automergeRepository, 'getHeads').mockImplementation((docId) => {
            if (docId === 'zeta') {
                return ['head-b', 'head-a'];
            }
            if (docId === 'root') {
                return ['head-d'];
            }
            return ['head-c'];
        });

        expect(JSON.parse(captureProjectRevision())).toEqual({
            documentIdentityEpoch: 7,
            documents: [
                { docId: 'alpha', heads: ['head-c'] },
                { docId: 'root', heads: ['head-d'] },
                { docId: 'zeta', heads: ['head-a', 'head-b'] },
            ],
        });
    });

    it('distinguishes replacement projects with equivalent empty roots', () => {
        const initialRevision = captureProjectRevision();

        automergeRepository.createProject('replacement project');

        expect(captureProjectRevision()).not.toBe(initialRevision);
    });
});
