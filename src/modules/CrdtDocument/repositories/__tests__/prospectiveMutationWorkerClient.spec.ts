import { change, clone, decodeChange, from, getActorId, getChanges, getHeads, load, save } from '@automerge/automerge';
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
    it('transfers only owned seed bytes and receives real one-change native candidate bytes', async () => {
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
        const candidate = change(
            load<Record<string, unknown>>(posted.seed, { actor: posted.actor }),
            { message: posted.message },
            (draft) => applyCanonicalStorageSlotMutation(draft, posted.mutation)
        );
        const bytes = Uint8Array.from(save(candidate));
        const reply = structuredClone({ status: 'complete', bytes }, { transfer: [bytes.buffer] });
        expect(bytes.byteLength).toBe(0);
        // Node's structuredClone returns its host-realm typed array; browser messaging rehomes it.
        worker.onmessage?.(new MessageEvent('message', { data: { ...reply, bytes: Uint8Array.from(reply.bytes) } }));
        const actual = load<{ slot: { count: number } }>(await result, { actor: request.actor });
        const changes = getChanges(doc, actual);
        expect(changes).toHaveLength(1);
        expect(decodeChange(changes[0]!)).toMatchObject({
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
