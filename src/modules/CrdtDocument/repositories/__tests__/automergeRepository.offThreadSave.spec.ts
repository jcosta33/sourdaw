import { load, loadIncremental } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    ControlledWorker,
    createRootBundle,
    respondToCompactShadow,
    respondToLoad,
    type BundleEntry,
    type CompactShadowRequest,
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
