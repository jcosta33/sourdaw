import { getAllChanges, getHeads } from '@automerge/automerge';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { automergeRepository } from '../../repositories/automergeRepository';
import { captureProjectRootIdentity } from '../captureProjectRootIdentity';
import { prepareExternalProjectDocument } from '../prepareExternalProjectDocument';
import { encodeSdawFile } from '../sdawFileFormat/encodeSdawFile';

class UnavailableWorker {
    constructor() {
        throw new Error('Worker unavailable in focused document test');
    }
}

const projectId = '00000000-0000-4000-8000-000000000001';

describe('external project document preflight and commit', () => {
    beforeEach(() => {
        vi.stubGlobal('indexedDB', new IDBFactory());
        vi.stubGlobal('IDBKeyRange', IDBKeyRange);
        vi.stubGlobal('Worker', UnavailableWorker);
        automergeRepository.reset();
        automergeRepository.createProject('outgoing');
        automergeRepository.changeDoc('root', (root: Record<string, unknown>) => {
            root.projectMeta = { projectId: '00000000-0000-4000-8000-000000000002' };
            root.outgoing = true;
        });
    });

    afterEach(() => {
        automergeRepository.reset();
        vi.unstubAllGlobals();
    });

    it('rejects corrupt bytes and a different project identity before changing the open document', async () => {
        const before = captureProjectRootIdentity();
        await expect(prepareExternalProjectDocument(new Uint8Array([1, 2, 3]), projectId)).rejects.toThrow();
        expect(captureProjectRootIdentity()).toBe(before);
        const mismatched = encodeSdawFile(automergeRepository.saveAll());
        await expect(prepareExternalProjectDocument(mismatched, projectId)).rejects.toThrow('identity differs');
        expect(captureProjectRootIdentity()).toBe(before);
    });

    it('loads the validated exact change graph only after the current transition commits', async () => {
        automergeRepository.changeDoc('root', (root: Record<string, unknown>) => {
            root.projectMeta = { projectId };
            root.take = 1;
        });
        automergeRepository.changeDoc('root', (root: Record<string, unknown>) => {
            root.take = 2;
        });
        const source = automergeRepository.getDoc<Record<string, unknown>>('root');
        if (!source) {
            throw new Error('Expected the source document');
        }
        const sourceHeads = getHeads(source);
        const sourceChanges = getAllChanges(source).length;
        const bytes = encodeSdawFile(automergeRepository.saveAll());
        const prepared = await prepareExternalProjectDocument(bytes, projectId);
        automergeRepository.changeDoc('root', (root: Record<string, unknown>) => {
            root.outgoing = 'later edit';
        });
        const before = captureProjectRootIdentity();
        await expect(prepared.commit(() => false)).resolves.toBe(false);
        expect(captureProjectRootIdentity()).toBe(before);
        await expect(prepared.commit(() => true)).resolves.toBe(true);
        const reopened = automergeRepository.getDoc<Record<string, unknown>>('root');
        if (!reopened) {
            throw new Error('Expected the reopened document');
        }
        expect(getHeads(reopened)).toEqual(sourceHeads);
        expect(getAllChanges(reopened)).toHaveLength(sourceChanges);
        expect(reopened.take).toBe(2);
        expect(reopened.outgoing).toBe(true);
    });
});
