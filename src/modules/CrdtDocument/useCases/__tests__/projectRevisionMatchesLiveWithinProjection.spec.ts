import { clone } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { automergeRepository } from '../../repositories/automergeRepository';
import { captureProjectRevision } from '../captureProjectRevision';
import { projectRevisionMatchesLiveWithinProjection } from '../projectRevisionMatchesLiveWithinProjection';

const source = (document: Readonly<Record<string, unknown>>) => ({ source: document.source, tempo: document.tempo });

beforeEach(() => {
    automergeRepository.reset();
    automergeRepository.createProject('source projection');
    automergeRepository.changeDoc('root', (document: Record<string, unknown>) => {
        document.source = 1;
        document.tempo = 60;
    });
});
afterEach(() => {
    automergeRepository.reset();
});

describe('owner source revision projection', () => {
    it('accepts the unchanged source', () => {
        expect(projectRevisionMatchesLiveWithinProjection(captureProjectRevision(), source)).toBe(true);
    });
    it.each(['source', 'tempo'])('rejects %s changes even after the original value returns', (key) => {
        const revision = captureProjectRevision();
        const original = key === 'source' ? 1 : 60;
        automergeRepository.changeDoc('root', (document: Record<string, unknown>) => {
            document[key] = original + 1;
        });
        automergeRepository.changeDoc('root', (document: Record<string, unknown>) => {
            document[key] = original;
        });
        expect(projectRevisionMatchesLiveWithinProjection(revision, source)).toBe(false);
    });
    it('accepts unrelated peer, selection and save writes', () => {
        const revision = captureProjectRevision();
        automergeRepository.changeDoc('root', (document: Record<string, unknown>) => {
            document.peerName = 'new name';
            document.selectedTrackId = 'peer';
            document.updatedAt = 1234;
        });
        expect(projectRevisionMatchesLiveWithinProjection(revision, source)).toBe(true);
    });
    it('rejects a same-bytes replacement root', () => {
        const revision = captureProjectRevision();
        const document = automergeRepository.getDoc<Record<string, unknown>>('root');
        if (!document) {
            throw new Error('Expected root');
        }
        automergeRepository.replaceDoc('root', clone(document));
        expect(projectRevisionMatchesLiveWithinProjection(revision, source)).toBe(false);
    });
    it('rejects an invalid captured revision', () => {
        expect(projectRevisionMatchesLiveWithinProjection('invalid', source)).toBe(false);
    });
});
