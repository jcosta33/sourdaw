import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { automergeRepository } from '../../repositories/automergeRepository';
import { captureProjectIdentity } from '../captureProjectIdentity';
import { captureProjectRevision } from '../captureProjectRevision';

describe('captureProjectIdentity', () => {
    beforeEach(() => {
        automergeRepository.reset();
        automergeRepository.createProject('identity test');
    });

    afterEach(() => {
        automergeRepository.reset();
    });

    it('stays stable across an ordinary document mutation that moves the revision', () => {
        const initialIdentity = captureProjectIdentity();
        const initialRevision = captureProjectRevision();

        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.tempo = 128;
        });

        expect(captureProjectRevision()).not.toBe(initialRevision);
        expect(captureProjectIdentity()).toBe(initialIdentity);
    });

    it('changes when the loaded project is replaced', () => {
        const initialIdentity = captureProjectIdentity();

        automergeRepository.createProject('replacement project');

        expect(captureProjectIdentity()).not.toBe(initialIdentity);
    });
});
