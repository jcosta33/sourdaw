import { change, init, load, save, toJS } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ControlledWorker, respondToLoad, respondToMerge, type MergeBundleRequest } from './automergeWorkerTestHarness';

describe('active root installations', () => {
    beforeEach(() => {
        ControlledWorker.reset();
        vi.resetModules();
        vi.stubGlobal('Worker', ControlledWorker);
    });

    afterEach(() => {
        vi.doUnmock('@automerge/automerge');
        vi.unstubAllGlobals();
        vi.resetModules();
    });

    it('reports only installed root identities, absence, and terminal reset before change listeners', async () => {
        const { automergeRepository: repository } = await import('../automergeRepository');
        const observed: unknown[] = [];
        const notifications: number[] = [];
        repository.createProject('first');
        repository.onRootInstallation((installation) => {
            observed.push(
                installation.kind === 'reset' ? 'reset' : installation.document && toJS(installation.document)
            );
        });
        repository.onChange(() => notifications.push(observed.length));
        repository.createChildDoc('branch_one');
        repository.insertDoc('branch_one', init());
        expect(observed).toEqual([]);

        const first = change(init<{ value?: number }>(), (document) => {
            document.value = 1;
        });
        repository.insertDoc('root', first);
        expect(observed).toEqual([{ value: 1 }]);
        expect(notifications).toEqual([]);
        repository.replaceDoc('root', first);
        expect(observed).toHaveLength(2);
        expect(notifications).toEqual([2]);

        repository.restoreSnapshot(new Map([['root', { state: 'absent' }]]));
        expect(observed.at(-1)).toBeUndefined();
        expect(notifications.at(-1)).toBe(observed.length);
        repository.restoreSnapshot(new Map([['root', { state: 'present', bytes: save(first) }]]));
        expect(observed.at(-1)).toEqual({ value: 1 });
        repository.removeDoc('root');
        expect(observed.at(-1)).toBeUndefined();
        repository.createChildDoc('root');
        expect(observed.at(-1)).toEqual({});
        repository.reset();
        expect(observed.at(-1)).toBe('reset');
        const count = observed.length;
        repository.createProject('next');
        expect(observed).toHaveLength(count);
    });

    it('reports successful project creation while subscribed without publishing a change', async () => {
        const { automergeRepository: repository } = await import('../automergeRepository');
        repository.createProject('old');
        repository.changeDoc('root', (document: { old?: boolean }) => {
            document.old = true;
        });
        const observed: unknown[] = [];
        const notified = vi.fn();
        repository.onRootInstallation((installation) => {
            observed.push(installation.kind === 'installed' && installation.document && toJS(installation.document));
        });
        repository.onChange(notified);

        repository.createProject('replacement');

        expect(repository.getDoc('root')).toBeDefined();
        expect(observed).toEqual([{}]);
        expect(notified).not.toHaveBeenCalled();
    });

    it('reports worker root merges before normal notifications for existing and missing roots', async () => {
        ControlledWorker.onPostMessage = (worker, request) => {
            queueMicrotask(() => {
                if (request.type === 'loadBundle') {
                    respondToLoad(worker, request);
                } else if (request.type === 'mergeBundle') {
                    respondToMerge(worker, request);
                }
            });
        };
        const { automergeRepository: repository } = await import('../automergeRepository');
        repository.createProject('project');
        repository.changeDoc('root', (document: { value?: number }) => {
            document.value = 1;
        });
        const root = repository.getDoc<{ value?: number }>('root');
        if (!root) {
            throw new Error('Missing root');
        }
        const incoming = change(load<{ value?: number }>(save(root)), (document) => {
            document.value = 2;
        });
        const observed: unknown[] = [];
        const notifications: number[] = [];
        repository.onRootInstallation((installation) => {
            observed.push(
                installation.kind === 'installed' ? installation.document && toJS(installation.document) : 'reset'
            );
        });
        repository.onChange(() => notifications.push(observed.length));

        await repository.mergeBundle(new Map([['root', save(incoming)]]));
        expect(observed).toEqual([{ value: 2 }]);
        expect(notifications).toEqual([1]);

        repository.removeDoc('root');
        await repository.mergeBundle(new Map([['root', save(incoming)]]));
        expect(observed).toEqual([{ value: 2 }, undefined, { value: 2 }]);
        expect(notifications).toEqual([1, 3]);
    });

    it('does not report cancelled decode and reports a committed load before its change notification', async () => {
        ControlledWorker.onPostMessage = (worker, request) => {
            if (request.type === 'loadBundle') {
                queueMicrotask(() => respondToLoad(worker, request));
            }
        };
        const { automergeRepository: repository } = await import('../automergeRepository');
        repository.createProject('old');
        const observed: unknown[] = [];
        const notifications: number[] = [];
        repository.onRootInstallation((installation) => {
            observed.push(installation.kind === 'installed' ? toJS(installation.document!) : 'reset');
        });
        repository.onChange(() => notifications.push(observed.length));
        const next = change(init<{ value?: number }>(), (document) => {
            document.value = 2;
        });
        const bundle = new Map([['root', save(next)]]);
        await expect(repository.loadAll({ bundle, shouldCommit: () => false })).resolves.toBe(false);
        expect(observed).toEqual([]);
        await expect(repository.loadAll({ bundle })).resolves.toBe(true);
        expect(observed).toEqual([{ value: 2 }]);
        expect(notifications).toEqual([1]);
    });

    it('reports a changed existing root installed before a later worker entry fails', async () => {
        let mergeRequest: { worker: ControlledWorker; request: MergeBundleRequest } | undefined;
        ControlledWorker.onPostMessage = (worker, request) => {
            if (request.type === 'loadBundle') {
                queueMicrotask(() => respondToLoad(worker, request));
            } else if (request.type === 'mergeBundle') {
                mergeRequest = { worker, request };
            }
        };
        const { automergeRepository: repository } = await import('../automergeRepository');
        repository.createProject('project');
        repository.changeDoc('root', (document: { value?: number }) => {
            document.value = 1;
        });
        const original = repository.getDoc<{ value?: number }>('root');
        if (!original) {
            throw new Error('Missing root');
        }
        const changed = change(load<{ value?: number }>(save(original)), (document) => {
            document.value = 2;
        });
        const observed: unknown[] = [];
        const epoch = repository.getMutationEpoch();
        repository.onRootInstallation((installation) => {
            if (installation.kind === 'installed') {
                observed.push(installation.document && toJS(installation.document));
            }
        });
        const pending = repository.mergeBundle(new Map([['root', save(changed)]]));
        await vi.waitFor(() => expect(mergeRequest).toBeDefined());
        if (!mergeRequest) {
            throw new Error('Missing worker merge request');
        }
        mergeRequest.worker.emitMessage({
            id: mergeRequest.request.id,
            type: 'merged',
            compacted: [
                ['root', save(changed)],
                ['branch_bad', new Uint8Array([1, 2, 3])],
            ],
            mergedDocIds: ['root'],
            newDocIds: ['branch_bad'],
        });
        await expect(pending).rejects.toThrow();
        expect(repository.getDoc<{ value?: number }>('root')?.value).toBe(2);
        expect(repository.getMutationEpoch()).toBeGreaterThan(epoch);
        expect(observed).toEqual([{ value: 2 }]);
    });

    it('reports remote and synchronous-fallback root installs without changing publication', async () => {
        vi.stubGlobal(
            'Worker',
            class {
                constructor() {
                    throw new Error('worker unavailable');
                }
            }
        );
        const { automergeRepository: repository } = await import('../automergeRepository');
        repository.createProject('project');
        const observed: unknown[] = [];
        const notifications: number[] = [];
        repository.onRootInstallation((installation) => {
            observed.push(
                installation.kind === 'installed' ? installation.document && toJS(installation.document) : 'reset'
            );
        });
        repository.onChange(() => notifications.push(observed.length));
        const incoming = change(init<{ value?: number }>(), (document) => {
            document.value = 3;
        });
        repository.removeDoc('root');
        repository.mergeRemoteDoc('root', save(incoming));
        expect(observed).toEqual([undefined, { value: 3 }]);
        expect(notifications).toEqual([2]);
        repository.removeDoc('root');
        await repository.mergeBundle(new Map([['root', save(incoming)]]));
        expect(observed).toEqual([undefined, { value: 3 }, undefined, { value: 3 }]);
        expect(notifications).toEqual([2, 4]);
    });

    it('reports an existing root merged by the synchronous fallback before a later decode fails', async () => {
        vi.stubGlobal(
            'Worker',
            class {
                constructor() {
                    throw new Error('worker unavailable');
                }
            }
        );
        vi.doMock('@automerge/automerge', async (importOriginal) => {
            const actual = await importOriginal<typeof import('@automerge/automerge')>();
            let failNextLoad = false;
            return {
                ...actual,
                merge: (left: Parameters<typeof actual.merge>[0], right: Parameters<typeof actual.merge>[1]) => {
                    const merged = actual.merge(left, right);
                    if ('value' in left && left.value === 1 && 'value' in right && right.value === 2) {
                        failNextLoad = true;
                    }
                    return merged;
                },
                load: (...args: Parameters<typeof actual.load>) => {
                    if (failNextLoad) {
                        throw new Error('later branch decode failed');
                    }
                    return actual.load(...args);
                },
            };
        });
        const { automergeRepository: repository } = await import('../automergeRepository');
        repository.createProject('project');
        repository.changeDoc('root', (document: { value?: number }) => {
            document.value = 1;
        });
        const root = repository.getDoc<{ value?: number }>('root');
        if (!root) {
            throw new Error('Missing root');
        }
        const changed = change(load<{ value?: number }>(save(root)), (document) => {
            document.value = 2;
        });
        const branch = change(init<{ ready?: boolean }>(), (document) => {
            document.ready = true;
        });
        const observed: unknown[] = [];
        const epoch = repository.getMutationEpoch();
        repository.onRootInstallation((installation) => {
            if (installation.kind === 'installed') {
                observed.push(installation.document && toJS(installation.document));
            }
        });

        await expect(
            repository.mergeBundle(
                new Map([
                    ['root', save(changed)],
                    ['branch_later', save(branch)],
                ])
            )
        ).rejects.toThrow('later branch decode failed');
        expect(repository.getDoc<{ value?: number }>('root')?.value).toBe(2);
        expect(repository.hasDoc('branch_later')).toBe(false);
        expect(repository.getMutationEpoch()).toBeGreaterThan(epoch);
        expect(observed).toEqual([{ value: 2 }]);
    });

    it('keeps a listener exception out of the product write result', async () => {
        const { automergeRepository: repository } = await import('../automergeRepository');
        repository.createProject('project');
        const notify = vi.fn();
        repository.onChange(notify);
        repository.onRootInstallation(() => {
            throw new Error('observer failed');
        });
        expect(() => repository.replaceDoc('root', init())).not.toThrow();
        expect(notify).toHaveBeenCalledWith('root', undefined);
    });

    it('reports absent root when project creation fails after clearing the old project', async () => {
        vi.doMock('@automerge/automerge', async (importOriginal) => ({
            ...(await importOriginal<typeof import('@automerge/automerge')>()),
            init: () => {
                throw new Error('init failed');
            },
        }));
        const { automergeRepository: repository } = await import('../automergeRepository');
        repository.insertDoc('root', init());
        const epoch = repository.getDocumentIdentityEpoch();
        const observed: unknown[] = [];
        repository.onRootInstallation((installation) => {
            observed.push(installation.kind === 'installed' ? installation.document : 'reset');
        });
        expect(() => repository.createProject('replacement')).toThrow('init failed');
        expect(repository.hasDoc('root')).toBe(false);
        expect(repository.getDocumentIdentityEpoch()).toBeGreaterThan(epoch);
        expect(observed).toEqual([undefined]);
    });
});
