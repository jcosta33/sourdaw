import { change, clone, init, load, save, type Doc } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ControlledWorker, deferFirstMergeRequest } from '../../../repositories/__tests__/automergeWorkerTestHarness';

type RootDocument = { projectMeta?: { name: string } };

const BEFORE = 'Before merge';
const AFTER = 'Installed prefix';
const PRIVATE = 'Private preview';

let cleanup: (() => void) | undefined;

function projectName(document: Doc<RootDocument> | undefined): string | undefined {
    return document?.projectMeta?.name;
}

async function openProject() {
    const storage = await import('#/infra/store/storage/createAutomergeStorage');
    const { defaultProjectStoreState, projectStore } = await import('#/modules/Project/stores');
    const { automergeRepository: repository } = await import('../../../repositories/automergeRepository');
    const { registerCrdtStorageRuntime } = await import('../../registerCrdtStorageRuntime');
    const { createCommandPreviewWorkspace } = await import('../../createCommandPreviewWorkspace');
    const { captureProjectRevision } = await import('../../captureProjectRevision');
    const { setupProjectionBridge } = await import('../setupProjectionBridge');

    repository.createProject('project');
    registerCrdtStorageRuntime();
    projectStore.set({ ...defaultProjectStoreState, name: BEFORE });
    storage.flushAutomergeStorageWrites();
    const unsubscribe = setupProjectionBridge();
    cleanup = () => {
        unsubscribe();
        storage.flushAutomergeStorageWrites();
        storage.configureAutomergeStoragePort(null);
        repository.reset();
    };

    const original = repository.getDoc<RootDocument>('root');
    if (!original?.projectMeta) {
        throw new Error('Expected a persisted project name');
    }
    const incoming = change(clone(original), (document) => {
        if (!document.projectMeta) {
            throw new Error('Expected the project metadata in the peer root');
        }
        document.projectMeta.name = AFTER;
    });
    const preview = createCommandPreviewWorkspace(captureProjectRevision());
    preview.scope(() => {
        projectStore.set({ ...defaultProjectStoreState, ...projectStore.value, name: PRIVATE });
    });

    const events: unknown[] = [];
    repository.onRootInstallation((installation) => {
        events.push({
            kind: 'root',
            name: installation.kind === 'installed' && projectName(installation.document),
            projected: projectStore.value?.name,
        });
    });
    repository.onChange((docId) => {
        events.push({ kind: 'change', docId, name: projectStore.value?.name });
    });

    return { repository, projectStore, incoming, preview, events };
}

describe('project projection after a partial bundle merge', () => {
    beforeEach(() => {
        ControlledWorker.reset();
        vi.resetModules();
        vi.stubGlobal('Worker', ControlledWorker);
    });

    afterEach(() => {
        cleanup?.();
        cleanup = undefined;
        vi.doUnmock('@automerge/automerge');
        vi.unstubAllGlobals();
        vi.resetModules();
    });

    it('projects an installed worker prefix before rejection and keeps private preview edits isolated', async () => {
        const deferred = deferFirstMergeRequest();
        const { repository, projectStore, incoming, preview, events } = await openProject();
        const corrupt = new Uint8Array([1, 2, 3]);
        let decodeMessage: string | undefined;
        try {
            load(corrupt);
        } catch (error) {
            if (error instanceof Error) {
                decodeMessage = error.message;
            }
        }
        expect(decodeMessage).toBeDefined();
        const pending = repository.mergeBundle(new Map([['root', save(incoming)]]));
        const rejected = pending.catch((error: unknown) => {
            events.push({
                kind: 'rejected',
                raw: projectName(repository.getDoc<RootDocument>('root')),
                projected: projectStore.value?.name,
            });
            return error;
        });
        const { worker, request } = await deferred.firstRequest;
        worker.emitMessage({
            id: request.id,
            type: 'merged',
            compacted: [
                ['root', save(incoming)],
                ['branch_later', corrupt],
            ],
            mergedDocIds: ['root'],
            newDocIds: ['branch_later'],
        });

        await expect(rejected).resolves.toMatchObject({ message: decodeMessage });
        expect(events).toEqual([
            { kind: 'root', name: AFTER, projected: BEFORE },
            { kind: 'change', docId: undefined, name: AFTER },
            { kind: 'rejected', raw: AFTER, projected: AFTER },
        ]);
        expect(repository.hasDoc('branch_later')).toBe(false);
        expect(preview.getProjectDocument().projectMeta).toMatchObject({ name: PRIVATE });
        expect(projectStore.value?.name).toBe(AFTER);
        preview.release();

        const next = change(clone(incoming), (document) => {
            if (document.projectMeta) {
                document.projectMeta.name = 'Next successful sync';
            }
        });
        await repository.mergeBundle(new Map([['root', save(next)]]));
        expect(projectName(repository.getDoc<RootDocument>('root'))).toBe('Next successful sync');
        expect(projectStore.value?.name).toBe('Next successful sync');
    }, 30_000);

    it('projects a synchronous prefix before propagating the original later decode failure', async () => {
        vi.stubGlobal(
            'Worker',
            class {
                constructor() {
                    throw new Error('worker unavailable');
                }
            }
        );
        const failure = new Error('later branch install decode failed');
        let laterLoads = 0;
        vi.doMock('@automerge/automerge', async (importOriginal) => {
            const actual = await importOriginal<typeof import('@automerge/automerge')>();
            return {
                ...actual,
                load: (...args: Parameters<typeof actual.load>) => {
                    const document = actual.load<{ failAtInstall?: boolean }>(...args);
                    if (document.failAtInstall) {
                        laterLoads += 1;
                        // The synchronous parser loads and compacts the input first.
                        // Its third decode is the authoritative installation pass.
                        if (laterLoads === 3) {
                            throw failure;
                        }
                    }
                    return document;
                },
            };
        });
        const { repository, projectStore, incoming, preview, events } = await openProject();
        const later = change(init<{ failAtInstall?: boolean }>(), (document) => {
            document.failAtInstall = true;
        });
        const rejected = repository
            .mergeBundle(
                new Map([
                    ['root', save(incoming)],
                    ['branch_later', save(later)],
                ])
            )
            .catch((error: unknown) => {
                events.push({
                    kind: 'rejected',
                    raw: projectName(repository.getDoc<RootDocument>('root')),
                    projected: projectStore.value?.name,
                });
                return error;
            });

        await expect(rejected).resolves.toBe(failure);
        expect(laterLoads).toBe(3);
        expect(events).toEqual([
            { kind: 'root', name: AFTER, projected: BEFORE },
            { kind: 'change', docId: undefined, name: AFTER },
            { kind: 'rejected', raw: AFTER, projected: AFTER },
        ]);
        expect(repository.hasDoc('branch_later')).toBe(false);
        expect(preview.getProjectDocument().projectMeta).toMatchObject({ name: PRIVATE });
        expect(projectStore.value?.name).toBe(AFTER);
        preview.release();
    }, 30_000);
});
