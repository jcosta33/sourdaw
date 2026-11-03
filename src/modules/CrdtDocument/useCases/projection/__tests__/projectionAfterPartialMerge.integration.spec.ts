import { change, clone, init, load, save, type Doc } from '@automerge/automerge';
import { beforeAll, describe, expect, it, onTestFailed, vi, type TestContext } from 'vitest';

import { ControlledWorker, deferFirstMergeRequest } from '../../../repositories/__tests__/automergeWorkerTestHarness';

type RootDocument = { projectMeta?: { name: string } };

const BEFORE = 'Before merge';
const AFTER = 'Installed prefix';
const PRIVATE = 'Private preview';

let graphReady = false;
let activeCase: { failed: boolean; signal: AbortSignal } | undefined;

type RegisterCleanup = (cleanup: () => void) => void;
type AssertActive = () => void;

function projectName(document: Doc<RootDocument> | undefined): string | undefined {
    return document?.projectMeta?.name;
}

async function openProject(
    registerCleanup: RegisterCleanup,
    assertActive: AssertActive,
    beforeInstall?: () => Promise<void>
) {
    assertActive();
    const storage = await import('#/infra/store/storage/createAutomergeStorage');
    const { defaultProjectStoreState, projectStore } = await import('#/modules/Project/stores');
    const { automergeRepository: repository } = await import('../../../repositories/automergeRepository');
    const { registerCrdtStorageRuntime } = await import('../../registerCrdtStorageRuntime');
    const { createCommandPreviewWorkspace } = await import('../../createCommandPreviewWorkspace');
    const { captureProjectRevision } = await import('../../captureProjectRevision');
    const { setupProjectionBridge } = await import('../setupProjectionBridge');
    if (beforeInstall) {
        await beforeInstall();
    }
    assertActive();

    let unsubscribe: (() => void) | undefined;
    let unsubscribeRoot: (() => void) | undefined;
    let unsubscribeChange: (() => void) | undefined;
    let releasePreview: (() => void) | undefined;
    registerCleanup(() => {
        releasePreview?.();
        unsubscribeChange?.();
        unsubscribeRoot?.();
        unsubscribe?.();
        storage.flushAutomergeStorageWrites();
        storage.configureAutomergeStoragePort(null);
        repository.reset();
    });

    repository.createProject('project');
    registerCrdtStorageRuntime();
    projectStore.set({ ...defaultProjectStoreState, name: BEFORE });
    storage.flushAutomergeStorageWrites();
    unsubscribe = setupProjectionBridge();

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
    releasePreview = preview.release;
    preview.scope(() => {
        projectStore.set({ ...defaultProjectStoreState, ...projectStore.value, name: PRIVATE });
    });

    const events: unknown[] = [];
    unsubscribeRoot = repository.onRootInstallation((installation) => {
        events.push({
            kind: 'root',
            name: installation.kind === 'installed' && projectName(installation.document),
            projected: projectStore.value?.name,
        });
    });
    unsubscribeChange = repository.onChange((docId) => {
        events.push({ kind: 'change', docId, name: projectStore.value?.name });
    });

    return { repository, projectStore, incoming, preview, events };
}

function projectCase(
    run: (fixture: {
        open: (beforeInstall?: () => Promise<void>) => ReturnType<typeof openProject>;
        assertActive: AssertActive;
    }) => Promise<void>
): (context: TestContext) => Promise<void> {
    return async (context) => {
        if (!graphReady) {
            throw new Error('Projection fixture graph did not finish loading');
        }
        if (activeCase) {
            throw new Error('Previous projection fixture is still active');
        }

        const owner = { failed: false, signal: context.signal };
        activeCase = owner;
        onTestFailed(() => {
            owner.failed = true;
        });
        const assertActive = () => {
            if (owner.failed || owner.signal.aborted) {
                throw new Error('Projection fixture case failed before async work settled');
            }
        };
        let cleanup: (() => void) | undefined;
        const registerCleanup: RegisterCleanup = (ownedCleanup) => {
            if (cleanup) {
                throw new Error('Projection fixture was opened twice in one case');
            }
            cleanup = ownedCleanup;
        };

        try {
            ControlledWorker.reset();
            vi.resetModules();
            vi.stubGlobal('Worker', ControlledWorker);
            await run({
                open: (beforeInstall) => openProject(registerCleanup, assertActive, beforeInstall),
                assertActive,
            });
        } finally {
            cleanup?.();
            vi.doUnmock('@automerge/automerge');
            vi.unstubAllGlobals();
            vi.resetModules();
            activeCase = undefined;
        }
    };
}

describe('project projection after a partial bundle merge', () => {
    beforeAll(async () => {
        const started = performance.now();
        await import('../setupProjectionBridge');
        if (performance.now() - started >= 60_000) {
            throw new Error('Projection fixture graph exceeded its setup deadline');
        }
        graphReady = true;
    }, 60_000);

    it(
        'projects an installed worker prefix before rejection and keeps private preview edits isolated',
        projectCase(async ({ open, assertActive }) => {
            const deferred = deferFirstMergeRequest();
            const { repository, projectStore, incoming, preview, events } = await open();
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
            assertActive();
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

            const rejection = await rejected;
            assertActive();
            expect(rejection).toMatchObject({ message: decodeMessage });
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
            assertActive();
            expect(projectName(repository.getDoc<RootDocument>('root'))).toBe('Next successful sync');
            expect(projectStore.value?.name).toBe('Next successful sync');
        }),
        30_000
    );

    it(
        'projects a synchronous prefix before propagating the original later decode failure',
        projectCase(async ({ open, assertActive }) => {
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
            const { repository, projectStore, incoming, preview, events } = await open();
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

            const rejection = await rejected;
            assertActive();
            expect(rejection).toBe(failure);
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
        }),
        30_000
    );

    describe('fixture deadline control', () => {
        for (const blockedPhase of ['setup', 'body'] as const) {
            describe(`blocked ${blockedPhase}`, () => {
                let release!: () => void;
                const gate = new Promise<void>((resolve) => {
                    release = resolve;
                });
                let finishFirst!: () => void;
                const firstFinished = new Promise<void>((resolve) => {
                    finishFirst = resolve;
                });
                let gateReached = false;
                let workerUnchangedAtRelease = false;
                let expiredAssertionAdmitted = false;
                let callsAtGate: number[] = [];
                let callsAfterDrain: number[] = [];
                let observeCalls: () => number[] = () => [];
                let restoreSpies = () => {};

                it.fails(
                    'expires while its real fixture is active',
                    async (context) => {
                        try {
                            await projectCase(async ({ open, assertActive }) => {
                                const firstWorker = globalThis.Worker;
                                const { automergeRepository } =
                                    await import('../../../repositories/automergeRepository');
                                const { projectStore } = await import('#/modules/Project/stores');
                                const createProject = vi.spyOn(automergeRepository, 'createProject');
                                const setProject = vi.spyOn(projectStore, 'set');
                                observeCalls = () => [createProject.mock.calls.length, setProject.mock.calls.length];
                                restoreSpies = () => {
                                    createProject.mockRestore();
                                    setProject.mockRestore();
                                };
                                const hold = async () => {
                                    callsAtGate = observeCalls();
                                    gateReached = true;
                                    await gate;
                                    workerUnchangedAtRelease = globalThis.Worker === firstWorker;
                                };
                                if (blockedPhase === 'setup') {
                                    await open(hold);
                                } else {
                                    await open();
                                    await hold();
                                }
                                assertActive();
                                expiredAssertionAdmitted = true;
                                expect(globalThis.Worker).toBe(firstWorker);
                            })(context);
                        } finally {
                            finishFirst();
                        }
                    },
                    5_000
                );

                it('refuses successor setup until the expired case settles', async (context) => {
                    const firstWorker = globalThis.Worker;
                    let successorEntered = false;
                    try {
                        expect(gateReached).toBe(true);
                        expect(activeCase?.failed).toBe(true);
                        expect(activeCase?.signal.aborted).toBe(true);
                        const reason: unknown = activeCase?.signal.reason;
                        if (!(reason instanceof Error)) {
                            throw new Error('Expected Vitest timeout error');
                        }
                        expect(reason.name).toBe('Error');
                        expect(reason.message).toMatch(/^Test timed out in 5000ms\./);
                        await expect(
                            projectCase(async ({ open }) => {
                                successorEntered = true;
                                vi.stubGlobal('Worker', class SuccessorWorker {});
                                vi.doMock('@automerge/automerge', async (importOriginal) => importOriginal());
                                const { projectStore } = await open();
                                const state = projectStore.value;
                                if (state === null) {
                                    throw new TypeError('Expected the opened successor project state.');
                                }
                                projectStore.set({ ...state, name: 'Successor fixture' });
                            })(context)
                        ).rejects.toThrow('Previous projection fixture is still active');
                        expect(successorEntered).toBe(false);
                        expect(globalThis.Worker).toBe(firstWorker);
                    } finally {
                        release();
                        await firstFinished;
                        callsAfterDrain = observeCalls();
                        restoreSpies();
                    }
                    if (blockedPhase === 'setup') {
                        expect(callsAtGate).toEqual([0, 0]);
                    } else {
                        expect(callsAtGate[0]).toBeGreaterThan(0);
                        expect(callsAtGate[1]).toBeGreaterThan(0);
                    }
                    expect(callsAfterDrain).toEqual(callsAtGate);
                    expect(workerUnchangedAtRelease).toBe(true);
                    expect(expiredAssertionAdmitted).toBe(false);
                    expect(activeCase).toBeUndefined();

                    await projectCase(async ({ open }) => {
                        const { repository, projectStore } = await open();
                        expect(projectStore.value?.name).toBe(BEFORE);
                        expect(projectName(repository.getDoc<RootDocument>('root'))).toBe(BEFORE);
                    })(context);
                }, 30_000);
            });
        }
    });
});
