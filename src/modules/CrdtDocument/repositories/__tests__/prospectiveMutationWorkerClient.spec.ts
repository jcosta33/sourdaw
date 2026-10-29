import {
    applyChanges,
    change,
    clone,
    decodeChange,
    from,
    getActorId,
    getChanges,
    getHeads,
    load,
    save,
} from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyCanonicalStorageSlotMutation } from '#/infra/store/storage/applyCanonicalStorageSlotMutation';

import { type ProspectiveMutationWorkerRequest } from '../../models/ProspectiveMutationWorkerProtocol';
import { requestProspectiveMutation } from '../prospectiveMutationWorkerClient';

class ControlledWorker {
    static instances: ControlledWorker[] = [];
    onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
    onerror: (() => void) | null = null;
    onmessageerror: (() => void) | null = null;
    terminate = vi.fn();
    posted?: ProspectiveMutationWorkerRequest;
    constructor() {
        ControlledWorker.instances.push(this);
    }
    postMessage(request: ProspectiveMutationWorkerRequest, transfer: Transferable[]) {
        this.posted = structuredClone(request, { transfer });
    }
}
function fixture() {
    const doc = from({ slot: { count: 0 } }, { actor: 'aaaaaaaaaaaaaaaa' });
    return {
        doc,
        request: {
            seed: Uint8Array.from(save(clone(doc))),
            heads: getHeads(doc),
            actor: getActorId(doc),
            message: 'Detect',
            mutation: {
                kind: 'canonical-json-slot-v1' as const,
                key: 'slot',
                baseValue: { count: 0 },
                value: { count: 1 },
                documentPresence: { slot: { count: 0 } },
            },
        },
    };
}
beforeEach(() => {
    ControlledWorker.instances = [];
    vi.stubGlobal('Worker', ControlledWorker);
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

function expectReleased(worker: ControlledWorker) {
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
    expect(worker.onmessageerror).toBeNull();
}

describe('prospective mutation Worker ownership', () => {
    it('accepts an owned zero-change response and releases its timer and listeners', async () => {
        vi.useFakeTimers();
        const { request } = fixture();
        const result = requestProspectiveMutation(request, new AbortController().signal);
        const worker = ControlledWorker.instances[0]!;
        worker.onmessage?.(
            new MessageEvent('message', { data: { status: 'complete', changes: [], heads: request.heads } })
        );
        expect(await result).toEqual({ changes: [], heads: request.heads });
        expectReleased(worker);
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([
        { changes: [Uint8Array.of(1), Uint8Array.of(2)], heads: [] },
        { changes: [new Uint8Array()], heads: [] },
        { changes: [], heads: ['invalid'] },
        { changes: [], heads: ['0'.repeat(64), '0'.repeat(64)] },
        { changes: [new Uint8Array(new SharedArrayBuffer(1))], heads: [] },
    ])('rejects a malformed or unowned delta envelope %#', async (response) => {
        const result = requestProspectiveMutation(fixture().request, new AbortController().signal);
        const rejected = expect(result).rejects.toThrow('Invalid prospective mutation Worker response');
        const worker = ControlledWorker.instances[0]!;
        worker.onmessage?.(new MessageEvent('message', { data: { status: 'complete', ...response } }));
        await rejected;
        expectReleased(worker);
    });

    it('transfers only owned seed bytes and receives real one-change native delta bytes', async () => {
        const { doc, request } = fixture();
        const originalBytes = save(clone(doc));
        const signal = new AbortController().signal;
        const removed = vi.spyOn(signal, 'removeEventListener');
        const result = requestProspectiveMutation(request, signal);
        expect(request.seed.byteLength).toBe(0);
        expect(originalBytes.byteLength).toBeGreaterThan(0);
        const worker = ControlledWorker.instances[0]!;
        const posted = worker.posted;
        if (!posted) throw new Error('Expected transferred request');
        const seed = load<Record<string, unknown>>(posted.seed, { actor: posted.actor });
        const candidate = change(seed, { message: posted.message }, (draft) =>
            applyCanonicalStorageSlotMutation(draft, posted.mutation)
        );
        const changes = getChanges(seed, candidate).map((bytes) => Uint8Array.from(bytes));
        const reply = structuredClone(
            { status: 'complete', changes, heads: getHeads(candidate) },
            { transfer: changes.map((bytes) => bytes.buffer) }
        );
        expect(changes[0]!.byteLength).toBe(0);
        // Node's structuredClone returns its host-realm typed array; browser messaging rehomes it.
        worker.onmessage?.(
            new MessageEvent('message', {
                data: { ...reply, changes: reply.changes.map((bytes) => Uint8Array.from(bytes)) },
            })
        );
        const response = await result;
        const [actual] = applyChanges(clone(doc, { actor: request.actor }), response.changes);
        expect(getHeads(actual)).toEqual(response.heads);
        expect(response.changes).toHaveLength(1);
        expect(decodeChange(response.changes[0]!)).toMatchObject({
            actor: request.actor,
            seq: 2,
            deps: getHeads(doc),
            message: 'Detect',
        });
        expect(actual.slot.count).toBe(1);
        expect(doc.slot.count).toBe(0);
        expectReleased(worker);
        expect(removed).toHaveBeenCalledWith('abort', expect.any(Function));
    });

    it.each(['abort', 'error', 'messageerror', 'timeout', 'invalid', 'failed', 'post throw'] as const)(
        'settles once and releases on %s including a late reply',
        async (kind) => {
            vi.useFakeTimers();
            if (kind === 'post throw')
                vi.spyOn(ControlledWorker.prototype, 'postMessage').mockImplementationOnce(() => {
                    throw new Error('post failed');
                });
            const { request } = fixture();
            const controller = new AbortController();
            const result = requestProspectiveMutation(request, controller.signal);
            const rejected = expect(result).rejects.toThrow();
            const worker = ControlledWorker.instances[0]!;
            const late = worker.onmessage;
            if (kind === 'abort') controller.abort();
            if (kind === 'error') worker.onerror?.();
            if (kind === 'messageerror') worker.onmessageerror?.();
            if (kind === 'timeout') await vi.advanceTimersByTimeAsync(30_000);
            if (kind === 'invalid')
                worker.onmessage?.(new MessageEvent('message', { data: { status: 'complete', bytes: [] } }));
            if (kind === 'failed')
                worker.onmessage?.(
                    new MessageEvent('message', { data: { status: 'failed', message: 'canonical refusal' } })
                );
            await rejected;
            late?.(new MessageEvent('message', { data: { status: 'complete', bytes: Uint8Array.of(1) } }));
            expectReleased(worker);
            expect(vi.getTimerCount()).toBe(0);
        }
    );
    it('does not construct a Worker after cancellation', async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(requestProspectiveMutation(fixture().request, controller.signal)).rejects.toThrow();
        expect(ControlledWorker.instances).toHaveLength(0);
    });
});
