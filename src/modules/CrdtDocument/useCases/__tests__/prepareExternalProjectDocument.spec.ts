import { getAllChanges, getHeads } from '@automerge/automerge';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { automergeRepository } from '../../repositories/automergeRepository';
import { branchStore, createDefaultBranchStoreState } from '../../stores/branchStore';
import { captureProjectRootIdentity } from '../captureProjectRootIdentity';
import { prepareExternalProjectDocument } from '../prepareExternalProjectDocument';
import { encodeSdawFile } from '../sdawFileFormat/encodeSdawFile';
import { whenBranchStateSettled } from '../whenBranchStateSettled';

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
        branchStore.set(createDefaultBranchStoreState());
        automergeRepository.createProject('outgoing');
        automergeRepository.changeDoc('root', (root: Record<string, unknown>) => {
            root.projectMeta = { projectId: '00000000-0000-4000-8000-000000000002' };
            root.outgoing = true;
        });
    });

    afterEach(() => {
        automergeRepository.reset();
        branchStore.set(createDefaultBranchStoreState());
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

    it('exposes the root track references from the validated bytes before commit', async () => {
        automergeRepository.changeDoc('root', (root: Record<string, unknown>) => {
            root.projectMeta = { projectId };
            root.tracks = { tracks: [{ id: 'track', clips: [{ id: 'clip', audioBufferId: 'missing-pcm' }] }] };
        });
        const before = captureProjectRootIdentity();
        const prepared = await prepareExternalProjectDocument(encodeSdawFile(automergeRepository.saveAll()), projectId);
        expect(prepared.rootMediaSlots.tracks).toMatchObject({
            tracks: [{ clips: [{ audioBufferId: 'missing-pcm' }] }],
        });
        expect(captureProjectRootIdentity()).toBe(before);
    });

    it('keeps the incoming saved root active even when the outgoing branch names a colliding slot', async () => {
        const { change, clone } = await import('@automerge/automerge');
        await whenBranchStateSettled();
        automergeRepository.changeDoc('root', (root: Record<string, unknown>) => {
            root.projectMeta = { projectId };
            root.tracks = { tracks: [{ id: 'main-track', clips: [] }] };
        });
        const main = automergeRepository.getDoc<Record<string, unknown>>('root');
        if (!main) {
            throw new Error('Expected root document');
        }
        const branch = change(clone(main), (draft) => {
            draft.tracks = { tracks: [{ id: 'branch-track', clips: [{ audioBufferId: 'branch-pcm' }] }] };
        });
        automergeRepository.insertDoc('branch_other', branch);
        const bytes = encodeSdawFile(automergeRepository.saveAll());
        const incomingHeads = getHeads(main);
        automergeRepository.changeDoc('root', (root: Record<string, unknown>) => {
            root.projectMeta = { projectId: '00000000-0000-4000-8000-000000000002' };
            root.outgoing = true;
        });
        branchStore.set({
            activeBranchId: 'other',
            branches: [
                ...createDefaultBranchStoreState().branches,
                {
                    branchId: 'other',
                    name: 'Other',
                    rootDocId: 'branch_other',
                    sourceBranchId: null,
                    createdAt: 1,
                    createdFromHeads: [],
                    note: '',
                },
            ],
        });

        const prepared = await prepareExternalProjectDocument(bytes, projectId);
        expect(prepared.rootMediaSlots.tracks).toMatchObject({
            tracks: [{ clips: [] }],
        });
        expect(await prepared.commit(() => true)).toBe(true);
        expect(automergeRepository.getDoc<Record<string, unknown>>('root')?.tracks).toMatchObject({
            tracks: [{ clips: [] }],
        });
        expect(getHeads(automergeRepository.getDoc<Record<string, unknown>>('root')!)).toEqual(incomingHeads);
    });
});
