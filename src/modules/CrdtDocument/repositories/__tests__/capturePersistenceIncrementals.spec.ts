import {
    change,
    getHeads,
    getMissingDeps,
    init,
    load,
    loadIncremental,
    save,
    saveSince,
    view,
} from '@automerge/automerge';
import { describe, expect, it, vi } from 'vitest';

import { type EncodedIncremental, type IncrementalEncodingInput } from '../../models/IncrementalPersistenceEncoding';
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

function encodeOwnedRequest(documents: IncrementalEncodingInput[]): EncodedIncremental[] {
    return documents.map(({ id, seed, frontier }) => {
        const loaded = load(seed);
        return { id, chunk: Uint8Array.from(saveSince(loaded, frontier)), heads: getHeads(loaded) };
    });
}

describe('capturePersistenceIncrementals', () => {
    it('captures every document before requesting and accepts exact bytes in capture order', async () => {
        const root = editAfterDurableBase('root change');
        const child = editAfterDurableBase('child change');
        const signal = new AbortController().signal;
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
        const workerReply = await request.mock.results[0]?.value;
        expect(result[0]?.chunk.buffer).toBe(workerReply?.documents[1]?.chunk.buffer);
        expect(result[1]?.chunk.buffer).toBe(workerReply?.documents[0]?.chunk.buffer);
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
            const invalidRoot = { ...expectedRoot, chunk: Uint8Array.from(saveSince(newer, root.frontier)) };
            const validChild = { ...expectedChild, chunk: Uint8Array.from(expectedChild.chunk) };
            const replacements = {
                'wrong response type': [invalidRoot, validChild],
                'missing document': [invalidRoot],
                'wrong document': [invalidRoot, { ...validChild, id: 'other' }],
                'duplicate document': [invalidRoot, invalidRoot],
                'stale heads': [{ ...invalidRoot, heads: getHeads(newer) }, validChild],
                'unrecognized bytes': [{ ...invalidRoot, chunk: [1] }, validChild],
                'partial buffer view': [{ ...invalidRoot, chunk: invalidRoot.chunk.subarray(1) }, validChild],
                'empty change': [{ ...invalidRoot, chunk: new Uint8Array() }, validChild],
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
                            chunk: Uint8Array.from(saveSince(root.live, root.frontier)),
                            heads: getHeads(root.live),
                        },
                    ],
                });
            }
            await expect(pending).rejects.toBe(reason);
        }
    );
});
