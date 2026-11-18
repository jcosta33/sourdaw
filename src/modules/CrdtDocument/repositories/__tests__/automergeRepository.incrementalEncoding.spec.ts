import * as native from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { retainsActiveFrontier } from '../../models/NativeIncrementalEncoding';
import { captureNativeIncrementals } from '../captureNativeIncrementals';
import { encodeNativeIncrementals } from '../encodeNativeIncrementals';

import {
    ControlledWorker,
    respondToEncodeIncrementals,
    type EncodeIncrementalsRequest,
} from './automergeWorkerTestHarness';

vi.mock('@automerge/automerge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@automerge/automerge')>();
    return { ...actual, saveSince: vi.fn(actual.saveSince), hasHeads: vi.fn(actual.hasHeads) };
});

type Held = { worker: ControlledWorker; request: EncodeIncrementalsRequest };
type Repository = typeof import('../automergeRepository').automergeRepository;

async function setup() {
    const { automergeRepository: repository } = await import('../automergeRepository');
    repository.reset();
    repository.createProject('Native incremental capture');
    repository.createChildDoc('child');
    for (const id of repository.getDocIds()) {
        repository.changeDoc(id, (doc: Record<string, unknown>) => {
            doc.payload = 'retained native data '.repeat(2048);
        });
    }
    const frontiers = new Map(repository.getDocIds().map((id) => [id, repository.getHeads(id)!]));
    for (const id of repository.getDocIds()) {
        repository.changeDoc(id, (doc: Record<string, unknown>) => {
            doc.first = id;
        });
    }
    const requested = Promise.withResolvers<Held>();
    ControlledWorker.onPostMessage = (worker, request) => {
        if (request.type === 'encodeIncrementals') {
            requested.resolve({ worker, request });
        }
    };
    return { repository, frontiers, requested };
}

function assertLiveCursors(repository: Repository): void {
    for (const id of repository.getDocIds()) {
        const source = repository.getDoc(id)!;
        const control = native.clone(source, { actor: native.getActorId(source) });
        try {
            const expected = native.saveIncremental(control);
            expect(expected.byteLength).toBeGreaterThan(0);
            expect(native.saveIncremental(source)).toEqual(expected);
        } finally {
            native.free(control);
        }
    }
}

describe('AutomergeRepository stateless incremental encoding', () => {
    beforeEach(() => {
        vi.resetModules();
        ControlledWorker.reset();
        vi.stubGlobal('Worker', ControlledWorker);
        vi.clearAllMocks();
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it.each(['worker', 'crash'] as const)(
        'captures all native versions synchronously and binds %s bytes to their own frontier',
        async (outcome) => {
            const { repository, frontiers, requested } = await setup();
            const expected = new Map(
                repository
                    .getDocIds()
                    .map((id) => [id, Uint8Array.from(native.saveSince(repository.getDoc(id)!, frontiers.get(id)!))])
            );
            const capturedHeads = new Map(repository.getDocIds().map((id) => [id, repository.getHeads(id)]));
            vi.mocked(native.saveSince).mockClear();
            const capture = repository.captureIncrementalsOffThread(frontiers);
            const held = await requested.promise;
            expect(native.saveSince).not.toHaveBeenCalled();
            expect(held.request.documents.map((doc) => doc.id).toSorted()).toEqual(['child', 'root']);
            for (const item of held.request.documents) {
                const decoded = native.load(item.seed);
                try {
                    expect(native.getHeads(decoded)).toEqual(item.heads);
                    expect(item.seed[8]).toBe(0);
                } finally {
                    native.free(decoded);
                }
                repository.changeDoc(item.id, (doc: Record<string, unknown>) => {
                    doc.later = true;
                });
            }
            if (outcome === 'worker') {
                respondToEncodeIncrementals(held.worker, held.request);
                vi.mocked(native.saveSince).mockClear();
            } else {
                held.worker.emitFatal('error');
            }
            const captured = await capture;
            expect(captured.isCurrent()).toBe(true);
            const expectedSaveCalls = outcome === 'crash' ? held.request.documents.length : 0;
            expect(native.saveSince).toHaveBeenCalledTimes(expectedSaveCalls);
            for (const item of captured.chunks) {
                expect(item.chunk).toEqual(expected.get(item.id));
                expect(item.heads).toEqual(capturedHeads.get(item.id));
                const base = native.clone(native.view(repository.getDoc(item.id)!, frontiers.get(item.id)!), {
                    actor: native.getActorId(repository.getDoc(item.id)!),
                });
                let replay = native.clone(base);
                let missing = native.init<Record<string, unknown>>();
                try {
                    missing = native.loadIncremental(missing, item.chunk);
                    expect(native.getMissingDeps(missing, []).length).toBeGreaterThan(0);
                    replay = native.loadIncremental(replay, item.chunk);
                    expect(native.getHeads(replay)).toEqual(item.heads);
                    expect(replay).toMatchObject({ first: item.id });
                    expect(replay).not.toHaveProperty('later');
                } finally {
                    native.free(base);
                    native.free(replay);
                    native.free(missing);
                }
            }
            assertLiveCursors(repository);
        }
    );

    it('does not request encoding or append bytes for genuinely unchanged native frontiers', async () => {
        const { repository } = await setup();
        const heads = new Map(repository.getDocIds().map((id) => [id, repository.getHeads(id)!]));
        const captured = await repository.captureIncrementalsOffThread(heads);
        expect(ControlledWorker.instances).toHaveLength(0);
        expect(captured.chunks).toHaveLength(2);
        expect(captured.chunks.every((item) => item.chunk.length === 0)).toBe(true);
        assertLiveCursors(repository);
    });

    it.each([
        'empty',
        'full',
        'truncated',
        'magic',
        'duplicate',
        'missing',
        'stale',
        'swapped',
        'offset',
        'wrong-type',
        'null-response',
    ] as const)('falls back to exact captured state for a %s response', async (kind) => {
        const { repository, frontiers, requested } = await setup();
        const expected = new Map(
            repository
                .getDocIds()
                .map((id) => [id, Uint8Array.from(native.saveSince(repository.getDoc(id)!, frontiers.get(id)!))])
        );
        const capture = repository.captureIncrementalsOffThread(frontiers);
        const held = await requested.promise;
        const documents = encodeNativeIncrementals(held.request.documents);
        if (kind === 'empty') {
            documents[0]!.chunk = new Uint8Array();
        }
        if (kind === 'full') {
            documents[0]!.chunk = held.request.documents[0]!.seed;
        }
        if (kind === 'truncated') {
            documents[0]!.chunk = Uint8Array.from(documents[0]!.chunk.slice(0, -1));
        }
        if (kind === 'magic') {
            documents[0]!.chunk[0] = 0;
        }
        if (kind === 'duplicate') {
            documents[1] = documents[0]!;
        }
        if (kind === 'missing') {
            documents.pop();
        }
        if (kind === 'stale') {
            documents[0]!.heads = ['a'.repeat(64)];
        }
        if (kind === 'swapped') {
            const id = documents[0]!.id;
            documents[0]!.id = documents[1]!.id;
            documents[1]!.id = id;
        }
        if (kind === 'offset') {
            const bytes = new Uint8Array(documents[0]!.chunk.length + 1);
            bytes.set(documents[0]!.chunk, 1);
            documents[0]!.chunk = bytes.subarray(1);
        }
        repository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.afterCapture = true;
        });
        if (kind === 'null-response') {
            held.worker.emitRawMessage(null);
        } else if (kind === 'wrong-type') {
            held.worker.emitMessage({ id: held.request.id, type: 'compacted', bundle: [] });
        } else {
            held.worker.emitMessage({ id: held.request.id, type: 'incrementalsEncoded', documents });
        }
        const actual = await capture;
        for (const item of actual.chunks) {
            expect(item.chunk).toEqual(expected.get(item.id));
        }
        assertLiveCursors(repository);
    });

    it.each(['replace', 'rollback'] as const)(
        'retires captured authority on %s while allowing ordinary later edits',
        async (kind) => {
            const { repository, frontiers, requested } = await setup();
            const before = repository.getDoc('root')!;
            const capture = repository.captureIncrementalsOffThread(frontiers);
            const held = await requested.promise;
            if (kind === 'replace') {
                repository.createProject('replacement');
            } else {
                repository.changeDoc('root', (doc: Record<string, unknown>) => {
                    doc.future = true;
                });
                repository.replaceDocInLineage(
                    'root',
                    native.clone(native.view(repository.getDoc('root')!, frontiers.get('root')!))
                );
            }
            respondToEncodeIncrementals(held.worker, held.request);
            const actual = await capture;
            expect(actual.isCurrent()).toBe(false);
            expect(actual.chunks.find((item) => item.id === 'root')?.heads).toEqual(native.getHeads(before));
        }
    );

    it('proves metadata ancestry without invoking the historical binary membership probe and keeps native history', async () => {
        const { repository, requested } = await setup();
        for (let index = 0; index < 2048; index++) {
            repository.changeDoc('root', (doc: Record<string, unknown>) => {
                doc.edit = index;
            });
        }
        const before = repository.getDoc('root')!;
        const heads = native.getHeads(before);
        repository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.metadata = true;
        });
        vi.mocked(native.hasHeads).mockClear();
        const capturing = repository.captureIncrementalsOffThread(new Map([['root', heads]]));
        const held = await requested.promise;
        respondToEncodeIncrementals(held.worker, held.request);
        const captured = await capturing;
        expect(native.hasHeads).not.toHaveBeenCalled();
        const root = captured.chunks.find((item) => item.id === 'root')!;
        const replay = native.loadIncremental(native.clone(before), root.chunk);
        try {
            expect(native.getHeads(replay)).toEqual(root.heads);
            expect(native.getChangesMetaSince(replay, []).length).toBeGreaterThanOrEqual(2051);
        } finally {
            native.free(replay);
        }
        assertLiveCursors(repository);
    });

    it('distinguishes queued missing dependencies from actual active ancestry', () => {
        const base = native.from({ count: 0 });
        const heads = native.getHeads(base);
        let peer = native.change(native.clone(base), (doc) => {
            doc.count = 1;
        });
        const missing = native.getHeads(peer);
        peer = native.change(peer, (doc) => {
            doc.count = 2;
        });
        const queuedHeads = native.getHeads(peer);
        const pending = native.applyChanges(native.clone(base), [native.getLastLocalChange(peer)!])[0];
        try {
            expect(native.getMissingDeps(pending, heads)).toEqual(missing);
            expect(retainsActiveFrontier(pending, heads)).toBe(true);
            expect(retainsActiveFrontier(pending, missing)).toBe(false);
            expect(retainsActiveFrontier(pending, queuedHeads)).toBe(false);
            expect(retainsActiveFrontier(pending, [...heads, ...queuedHeads])).toBe(false);
            expect(retainsActiveFrontier(pending, ['f'.repeat(64)])).toBe(false);
            const merged = native.merge(native.clone(base), peer);
            try {
                expect(retainsActiveFrontier(merged, heads)).toBe(true);
            } finally {
                native.free(merged);
            }
        } finally {
            native.free(base);
            native.free(peer);
            native.free(pending);
        }
    });

    it.each(['known', 'queued'] as const)(
        'preserves actual queued dependency state while exporting a %s requested frontier',
        async (kind) => {
            const base = native.from({ count: 0 });
            const baseHeads = native.getHeads(base);
            let peer = native.change(native.clone(base), (doc) => {
                doc.count = 1;
            });
            const missingHeads = native.getHeads(peer);
            peer = native.change(peer, (doc) => {
                doc.count = 2;
            });
            const queuedHeads = native.getHeads(peer);
            const pending = native.applyChanges(native.clone(base), [native.getLastLocalChange(peer)!])[0];
            const requested = kind === 'known' ? baseHeads : queuedHeads;
            const expected = Uint8Array.from(native.saveSince(pending, kind === 'known' ? baseHeads : []));
            try {
                const warn = vi.fn();
                const actual = await captureNativeIncrementals(
                    new Map([['root', pending]]),
                    new Map([['root', requested]]),
                    (documents) =>
                        Promise.resolve({
                            type: 'incrementalsEncoded',
                            documents: encodeNativeIncrementals(documents),
                        }),
                    warn
                );
                expect(warn).not.toHaveBeenCalled();
                expect(actual[0]?.chunk).toEqual(expected);
                expect(actual[0]?.heads).toEqual(baseHeads);
                expect(native.getMissingDeps(pending, [])).toEqual(missingHeads);
            } finally {
                native.free(base);
                native.free(peer);
                native.free(pending);
            }
        }
    );
});
