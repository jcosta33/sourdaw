import {
    change,
    getChangesSince,
    getHeads,
    getMissingDeps,
    init,
    load,
    loadIncremental,
    save,
    saveSince,
    view,
} from '@automerge/automerge';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { logger } from '#/infra/logger/appLogger';

import {
    type EncodedIncrementalFrames,
    type IncrementalEncodingInput,
} from '../../models/IncrementalPersistenceEncoding';
import { capturePersistenceIncrementals } from '../capturePersistenceIncrementals';

type TestDocument = { edit?: string; baseline?: boolean; later?: string };

function editAfterDurableBase(edit: string) {
    const baseline = change(init<TestDocument>(), (doc) => {
        doc.baseline = true;
    });
    const durable = save(baseline);
    const frontier = getHeads(baseline);
    const live = change(baseline, (doc) => {
        doc.edit = edit;
    });
    return { live, durable, frontier };
}

function encodeOwnedRequest(documents: IncrementalEncodingInput[]): EncodedIncrementalFrames[] {
    return documents.map(({ id, seed, frontier }) => {
        const loaded = load(seed);
        return {
            id,
            frames: getChangesSince(loaded, frontier).map((frame) => Uint8Array.from(frame)),
            heads: getHeads(loaded),
        };
    });
}

describe('capturePersistenceIncrementals', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('captures every document before requesting and accepts exact bytes in capture order', async () => {
        const root = editAfterDurableBase('root change');
        const child = editAfterDurableBase('child change');
        const signal = new AbortController().signal;
        const warn = vi.spyOn(logger, 'warn');
        const request = vi.fn((documents: IncrementalEncodingInput[]) =>
            Promise.resolve({ type: 'incrementalsEncoded', documents: encodeOwnedRequest(documents).reverse() })
        );
        const result = await capturePersistenceIncrementals({
            documents: [
                ['root', root.live],
                ['child', child.live],
            ],
            exportFrontiers: new Map([
                ['root', root.frontier],
                ['child', child.frontier],
            ]),
            request,
            signal,
        });
        expect(request).toHaveBeenCalledExactlyOnceWith(expect.any(Array), signal);
        const inputs = request.mock.calls[0]?.[0];
        expect(inputs?.map((doc) => doc.id)).toEqual(['root', 'child']);
        expect(inputs?.map((doc) => getHeads(load(doc.seed)))).toEqual([getHeads(root.live), getHeads(child.live)]);
        expect(warn).not.toHaveBeenCalled();
        expect(result).toEqual([
            { id: 'root', chunk: saveSince(root.live, root.frontier), heads: getHeads(root.live) },
            { id: 'child', chunk: saveSince(child.live, child.frontier), heads: getHeads(child.live) },
        ]);
    });

    it.each([
        'rejected transport',
        'wrong response type',
        'missing document',
        'wrong document',
        'duplicate document',
        'stale heads',
        'unrecognized bytes',
        'partial buffer view',
        'empty change',
    ] as const)('uses the original captures after %s despite a later live edit', async (problem) => {
        const root = editAfterDurableBase('captured root');
        const child = editAfterDurableBase('captured child');
        const expectedRoot = { id: 'root', chunk: saveSince(root.live, root.frontier), heads: getHeads(root.live) };
        const expectedChild = {
            id: 'child',
            chunk: saveSince(child.live, child.frontier),
            heads: getHeads(child.live),
        };
        const reply = Promise.withResolvers<unknown>();
        const request = vi.fn((documents: IncrementalEncodingInput[]) => {
            structuredClone(documents, { transfer: documents.map((document) => document.seed.buffer) });
            return reply.promise;
        });
        const result = capturePersistenceIncrementals({
            documents: [
                ['root', root.live],
                ['child', child.live],
            ],
            exportFrontiers: new Map([
                ['root', root.frontier],
                ['child', child.frontier],
            ]),
            request,
            signal: new AbortController().signal,
        });
        expect(request).toHaveBeenCalledOnce();
        const newer = change(root.live, (doc) => {
            doc.later = 'must not be persisted by this capture';
        });

        if (problem === 'rejected transport') {
            reply.reject(new Error('worker unavailable'));
        } else {
            const newerFrame = getChangesSince(newer, expectedRoot.heads)[0];
            if (!newerFrame) {
                throw new Error('Expected a native frame for the later edit');
            }
            const invalidRoot = { id: 'root', heads: expectedRoot.heads, frames: [Uint8Array.from(newerFrame)] };
            const validChild = {
                id: 'child',
                heads: expectedChild.heads,
                frames: [Uint8Array.from(expectedChild.chunk)],
            };
            const replacements = {
                'wrong response type': [invalidRoot, validChild],
                'missing document': [invalidRoot],
                'wrong document': [invalidRoot, { ...validChild, id: 'other' }],
                'duplicate document': [invalidRoot, invalidRoot],
                'stale heads': [{ ...invalidRoot, heads: getHeads(newer) }, validChild],
                'unrecognized bytes': [{ ...invalidRoot, frames: [1] }, validChild],
                'partial buffer view': [{ ...invalidRoot, frames: [invalidRoot.frames[0]?.subarray(1)] }, validChild],
                'empty change': [{ ...invalidRoot, frames: [] }, validChild],
            };
            reply.resolve({
                type: problem === 'wrong response type' ? 'loaded' : 'incrementalsEncoded',
                documents: replacements[problem],
            });
        }
        const encoded = await result;
        expect(encoded).toEqual([expectedRoot, expectedChild]);
        const delta = encoded[0]?.chunk;
        if (!delta) {
            throw new Error('Expected the captured root delta');
        }
        const withoutBase = loadIncremental(init(), delta);
        expect(getMissingDeps(withoutBase, root.frontier)).toEqual(root.frontier);
        const restored = loadIncremental(load(root.durable), delta);
        expect(restored).toEqual({ baseline: true, edit: 'captured root' });
        expect(getHeads(restored)).toEqual(expectedRoot.heads);
    });

    it.each(['corrupt', 'truncated', 'different native change'] as const)(
        'recovers the captured delta from %s bytes with truthful declared heads',
        async (kind) => {
            const root = editAfterDurableBase('durable edit');
            const warn = vi.spyOn(logger, 'warn');
            const capturedHeads = getHeads(root.live);
            const captured = saveSince(root.live, root.frontier);
            const other = change(load<TestDocument>(root.durable), (doc) => {
                doc.edit = 'different edit';
            });
            const corrupt = Uint8Array.from(captured);
            corrupt[4] = (corrupt[4] ?? 0) ^ 1;
            const changed = {
                corrupt,
                truncated: Uint8Array.from(captured.slice(0, -1)),
                'different native change': Uint8Array.from(saveSince(other, root.frontier)),
            };
            const request = () =>
                Promise.resolve({
                    type: 'incrementalsEncoded',
                    documents: [{ id: 'root', heads: capturedHeads, frames: [changed[kind]] }],
                });

            const [encoded] = await capturePersistenceIncrementals({
                documents: [['root', root.live]],
                exportFrontiers: new Map([['root', root.frontier]]),
                request,
                signal: new AbortController().signal,
            });
            expect(warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('invalid incremental encoding'));
            expect(encoded).toEqual({ id: 'root', heads: capturedHeads, chunk: captured });
            if (!encoded) {
                throw new Error('Expected verified captured delta');
            }
            const replayed = loadIncremental(load<TestDocument>(root.durable), encoded.chunk);
            expect(replayed.edit).toBe('durable edit');
            expect(getHeads(replayed)).toEqual(capturedHeads);
        }
    );

    it('stops validation on supersession between bounded native frame batches', async () => {
        const root = editAfterDurableBase('first edit');
        let latest = root.live;
        for (let index = 0; index < 16; index++) {
            latest = change(latest, (doc) => {
                doc.later = String(index);
            });
        }
        const request = (documents: IncrementalEncodingInput[]) =>
            Promise.resolve({ type: 'incrementalsEncoded', documents: encodeOwnedRequest(documents) });
        const controller = new AbortController();
        const reason = new DOMException('Superseded while validating native changes', 'AbortError');
        const warn = vi.spyOn(logger, 'warn');
        const NativeChannel = MessageChannel;
        let taskCount = 0;
        vi.stubGlobal(
            'MessageChannel',
            class extends NativeChannel {
                constructor() {
                    super();
                    taskCount++;
                    if (taskCount === 3) {
                        queueMicrotask(() => controller.abort(reason));
                    }
                }
            }
        );

        await expect(
            capturePersistenceIncrementals({
                documents: [['root', latest]],
                exportFrontiers: new Map([['root', root.frontier]]),
                request,
                signal: controller.signal,
            })
        ).rejects.toBe(reason);
        expect(taskCount).toBe(3);
        expect(warn).not.toHaveBeenCalled();
    });

    it('does not ask the worker to encode an unchanged document', async () => {
        const root = editAfterDurableBase('already exported');
        const request = vi.fn(() => Promise.reject(new Error('Unexpected request')));
        await expect(
            capturePersistenceIncrementals({
                documents: [['root', root.live]],
                exportFrontiers: new Map([['root', getHeads(root.live)]]),
                request,
                signal: new AbortController().signal,
            })
        ).resolves.toEqual([]);
        expect(request).not.toHaveBeenCalled();
    });

    it('rejects an outdated backing handle before transport or fallback', async () => {
        const root = editAfterDurableBase('future write');
        const request = vi.fn(() => Promise.reject(new Error('Unexpected request')));
        await expect(
            capturePersistenceIncrementals({
                documents: [['root', view(root.live, root.frontier)]],
                exportFrontiers: new Map([['root', root.frontier]]),
                request,
                signal: new AbortController().signal,
            })
        ).rejects.toThrow('Cannot export incremental bytes for outdated document root');
        expect(request).not.toHaveBeenCalled();
    });

    it.each(['completed reply', 'malformed reply', 'rejected request'])(
        'honors supersession after %s',
        async (completion) => {
            const root = editAfterDurableBase('retired edit');
            const reply = Promise.withResolvers<unknown>();
            const controller = new AbortController();
            const request = vi.fn(() => reply.promise);
            const pending = capturePersistenceIncrementals({
                documents: [['root', root.live]],
                exportFrontiers: new Map([['root', root.frontier]]),
                request,
                signal: controller.signal,
            });
            expect(request).toHaveBeenCalledOnce();
            const reason = new DOMException('Persistence generation superseded', 'AbortError');
            controller.abort(reason);
            if (completion === 'rejected request') {
                reply.reject(new Error('worker stopped'));
            } else if (completion === 'malformed reply') {
                reply.resolve({ type: 'incrementalsEncoded', documents: [] });
            } else {
                reply.resolve({
                    type: 'incrementalsEncoded',
                    documents: [
                        {
                            id: 'root',
                            frames: getChangesSince(root.live, root.frontier).map((frame) => Uint8Array.from(frame)),
                            heads: getHeads(root.live),
                        },
                    ],
                });
            }
            await expect(pending).rejects.toBe(reason);
        }
    );
});
