import { clone, getHeads, load, loadIncremental } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    ControlledWorker,
    createRootBundle,
    respondToCompactShadow,
    respondToEncodeIncrementals,
    respondToLoad,
    type BundleEntry,
    type CompactShadowRequest,
    type EncodeIncrementalsRequest,
} from './automergeWorkerTestHarness';

type ProjectDoc = Record<string, unknown>;
type AutomergeRepository = typeof import('../automergeRepository').automergeRepository;

type WorkerExchange = {
    compactRequests: CompactShadowRequest[];
    /** Exactly what the worker put on the wire for the last `compactShadow`. */
    lastCompactedBundle: BundleEntry[];
};

/** Answers `loadBundle` and `compactShadow` the way the real worker would. */
function serveWorker(): WorkerExchange {
    const exchange: WorkerExchange = { compactRequests: [], lastCompactedBundle: [] };

    ControlledWorker.onPostMessage = (worker, request) => {
        if (request.type === 'loadBundle') {
            queueMicrotask(() => respondToLoad(worker, request));
            return;
        }
        if (request.type !== 'compactShadow') {
            return;
        }
        exchange.compactRequests.push(request);
        queueMicrotask(() => {
            const emitted = vi.spyOn(worker, 'emitMessage');
            respondToCompactShadow(worker, request);
            const response = emitted.mock.calls[0]?.[0];
            if (response?.type === 'compacted') {
                exchange.lastCompactedBundle = response.bundle;
            }
            emitted.mockRestore();
        });
    };

    return exchange;
}

const baseBundle = createRootBundle();

async function loadRepositoryFromWorker(): Promise<AutomergeRepository> {
    const { automergeRepository } = await import('../automergeRepository');
    automergeRepository.reset();
    await expect(automergeRepository.loadAll({ bundle: new Map(baseBundle) })).resolves.toBe(true);
    return automergeRepository;
}

function serveWorkerWithCompactOutcome(react: (worker: ControlledWorker, requestId: number) => void): void {
    ControlledWorker.onPostMessage = (worker, request) => {
        if (request.type === 'loadBundle') {
            queueMicrotask(() => respondToLoad(worker, request));
            return;
        }
        if (request.type === 'compactShadow') {
            queueMicrotask(() => react(worker, request.id));
        }
    };
}

describe('AutomergeRepository off-thread full save (CC-8)', () => {
    beforeEach(() => {
        ControlledWorker.reset();
        vi.resetModules();
        vi.stubGlobal('Worker', ControlledWorker);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.resetModules();
    });

    it('returns the bytes the worker encoded, and ships only a delta to get them', async () => {
        const exchange = serveWorker();
        const automergeRepository = await loadRepositoryFromWorker();
        automergeRepository.changeDoc('root', (doc: ProjectDoc) => {
            doc.edited = 'after load';
        });

        const bundle = await automergeRepository.saveAllOffThread();

        // Nothing but a `saveSince` delta crossed the boundary: the full encode
        // happened in the worker, not on the main thread.
        expect(exchange.compactRequests).toHaveLength(1);
        expect(exchange.compactRequests[0]?.deltas.map(([id]) => id)).toEqual(['root']);
        expect(exchange.compactRequests[0]?.seeds).toEqual([]);
        // Byte-identity with the worker's payload — a main-thread `save()` would
        // have produced a different array instance.
        const workerRootBytes = exchange.lastCompactedBundle.find(([id]) => id === 'root')?.[1];
        expect(bundle.get('root')).toBe(workerRootBytes);
        expect(load<ProjectDoc>(bundle.get('root')!)).toMatchObject({ seed: true, edited: 'after load' });
    });

    it('transfers a native seed and returns only the exact requested persistence delta', async () => {
        const encodedRequest = Promise.withResolvers<{
            worker: ControlledWorker;
            request: EncodeIncrementalsRequest;
        }>();
        ControlledWorker.onPostMessage = (worker, request) => {
            if (request.type === 'loadBundle') {
                queueMicrotask(() => respondToLoad(worker, request));
            }
            if (request.type === 'encodeIncrementals') {
                encodedRequest.resolve({ worker, request });
            }
        };
        const repository = await loadRepositoryFromWorker();
        const frontier = repository.getHeads('root');
        if (!frontier) {
            throw new Error('Expected the root heads before capturing an incremental');
        }
        repository.changeDoc('root', (doc: ProjectDoc) => {
            doc.captured = true;
        });
        const capturedHeads = repository.getHeads('root');
        const capture = repository.capturePersistenceIncrementals(
            new Map([['root', frontier]]),
            new AbortController().signal
        );
        const { worker, request } = await encodedRequest.promise;
        expect(request.documents).toHaveLength(1);
        expect(request.documents[0]?.seed.byteLength).toBeGreaterThan(0);
        const transfer = worker.postMessageTransferArguments.at(-1);
        expect(transfer).toEqual([expect.any(ArrayBuffer)]);
        expect(transfer).toEqual([expect.objectContaining({ byteLength: 0 })]);
        repository.changeDoc('root', (doc: ProjectDoc) => {
            doc.afterCapture = true;
        });
        respondToEncodeIncrementals(worker, request);
        const [incremental] = await capture;
        if (!incremental) {
            throw new Error('Expected the captured root incremental');
        }
        expect(incremental.id).toBe('root');
        expect(incremental.heads).toEqual(capturedHeads);
        const replayed = loadIncremental(load<ProjectDoc>(baseBundle.get('root')!), incremental.chunk);
        expect(getHeads(replayed)).toEqual(capturedHeads);
        expect(replayed).toEqual({ seed: true, captured: true });
    });

    it('leaves the incremental cursor untouched so chunked persistence still works', async () => {
        serveWorker();
        const automergeRepository = await loadRepositoryFromWorker();
        // Drain the cursor so the next chunk covers only the edit below.
        automergeRepository.saveDocIncremental('root');
        automergeRepository.changeDoc('root', (doc: ProjectDoc) => {
            doc.chunked = true;
        });

        await automergeRepository.saveAllOffThread();
        const chunk = automergeRepository.saveDocIncremental('root');
        if (!chunk) {
            throw new Error('Expected an incremental chunk after the off-thread save');
        }

        // `saveSince` must not advance Automerge's incremental cursor, or the
        // coordinator's chunk would silently lose this edit.
        const replayed = loadIncremental(load<ProjectDoc>(baseBundle.get('root')!), chunk);
        expect(replayed).toMatchObject({ seed: true, chunked: true });
    });

    it('falls back to a main-thread save when the worker reports a stale replica', async () => {
        serveWorkerWithCompactOutcome((worker, requestId) => {
            worker.emitMessage({ id: requestId, type: 'compactStale', reason: 'forced divergence' });
        });
        const automergeRepository = await loadRepositoryFromWorker();
        automergeRepository.changeDoc('root', (doc: ProjectDoc) => {
            doc.staleFallback = true;
        });

        const bundle = await automergeRepository.saveAllOffThread();

        expect(load<ProjectDoc>(bundle.get('root')!)).toMatchObject({ seed: true, staleFallback: true });
    });

    it('falls back to a main-thread save when the worker crashes mid-request', async () => {
        serveWorkerWithCompactOutcome((worker) => {
            worker.emitFatal('error');
        });
        const automergeRepository = await loadRepositoryFromWorker();
        automergeRepository.changeDoc('root', (doc: ProjectDoc) => {
            doc.crashFallback = true;
        });

        const bundle = await automergeRepository.saveAllOffThread();

        expect(load<ProjectDoc>(bundle.get('root')!)).toMatchObject({ seed: true, crashFallback: true });
    });

    it('seeds a document the replica has never seen instead of dropping it', async () => {
        const exchange = serveWorker();
        const automergeRepository = await loadRepositoryFromWorker();
        automergeRepository.createChildDoc('branch_new');
        automergeRepository.changeDoc('branch_new', (doc: ProjectDoc) => {
            doc.branch = true;
        });

        const bundle = await automergeRepository.saveAllOffThread();

        expect(exchange.compactRequests[0]?.seeds.map(([id]) => id)).toEqual(['branch_new']);
        expect(load<ProjectDoc>(bundle.get('branch_new')!)).toMatchObject({ branch: true });
        expect(load<ProjectDoc>(bundle.get('root')!)).toMatchObject({ seed: true });
    });

    /**
     * A lineage replacement leaves the replica describing a document the
     * repository no longer holds. `saveSince` does not report that: given heads
     * from an unrelated lineage it returns a delta anyway, which the worker
     * would merge onto the wrong replica. The heads check would still refuse
     * the result, but the whole off-thread benefit would be forfeited at
     * exactly the new-project and branch-switch moments.
     */
    it.each([
        [
            'a new project replaces the root document',
            (repository: AutomergeRepository) => {
                repository.createProject('replacement');
                repository.changeDoc('root', (doc: ProjectDoc) => {
                    doc.freshProject = true;
                });
            },
            { freshProject: true },
        ],
        [
            'branching replaces the root document via insertDoc',
            (repository: AutomergeRepository) => {
                repository.createChildDoc('branch_source');
                repository.changeDoc('branch_source', (doc: ProjectDoc) => {
                    doc.branchTruth = true;
                });
                repository.insertDoc('root', clone(repository.getDoc('branch_source')!));
            },
            { branchTruth: true },
        ],
        [
            'a branch switch replaces the root document via replaceDoc',
            (repository: AutomergeRepository) => {
                repository.createChildDoc('branch_target');
                repository.changeDoc('branch_target', (doc: ProjectDoc) => {
                    doc.switchedIn = true;
                });
                repository.replaceDoc('root', clone(repository.getDoc('branch_target')!));
            },
            { switchedIn: true },
        ],
    ])('stays off-thread and correct when %s', async (_case, replaceLineage, expected) => {
        const exchange = serveWorker();
        const automergeRepository = await loadRepositoryFromWorker();
        // Warm the replica so a stale delta would be possible.
        await automergeRepository.saveAllOffThread();
        expect(exchange.compactRequests).toHaveLength(1);

        replaceLineage(automergeRepository);
        const bundle = await automergeRepository.saveAllOffThread();

        // Reseeded rather than delta'd, so the worker never merges the old
        // lineage into the new document...
        expect(exchange.compactRequests[1]?.seeds.map(([id]) => id)).toContain('root');
        expect(exchange.compactRequests[1]?.deltas.map(([id]) => id)).not.toContain('root');
        // ...and the save still ran off-thread rather than falling back.
        expect(exchange.compactRequests).toHaveLength(2);
        expect(bundle.get('root')).toBe(exchange.lastCompactedBundle.find(([id]) => id === 'root')?.[1]);

        const persistedRoot = load<ProjectDoc>(bundle.get('root')!);
        expect(persistedRoot).toMatchObject(expected);
        // The replaced project's truth must not survive in the new document.
        expect(persistedRoot).not.toHaveProperty('seed');
    });

    it('drops a locally removed document from the compacted bundle', async () => {
        const exchange = serveWorker();
        const automergeRepository = await loadRepositoryFromWorker();
        automergeRepository.createChildDoc('branch_temp');
        await automergeRepository.saveAllOffThread();
        automergeRepository.removeDoc('branch_temp');

        const bundle = await automergeRepository.saveAllOffThread();

        expect(exchange.compactRequests[1]?.removedDocIds).toEqual(['branch_temp']);
        expect([...bundle.keys()]).toEqual(['root']);
    });
});
