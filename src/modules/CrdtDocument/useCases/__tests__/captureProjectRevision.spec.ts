import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { automergeRepository } from '../../repositories/automergeRepository';
import { captureProjectRevision } from '../captureProjectRevision';

describe('captureProjectRevision', () => {
    beforeEach(() => {
        automergeRepository.reset();
        automergeRepository.createProject('revision test');
    });

    afterEach(() => {
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

    it('distinguishes replacement projects with equivalent empty roots', () => {
        const initialRevision = captureProjectRevision();

        automergeRepository.createProject('replacement project');

        expect(captureProjectRevision()).not.toBe(initialRevision);
    });
});
