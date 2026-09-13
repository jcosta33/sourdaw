import { describe, expect, it, vi } from 'vitest';

import { type WebLlmEngine } from '../engineLifecycleState';
import { webLlmRequestCoordinator } from '../webLlmRequestCoordinator';

function createEngine() {
    const interruptGenerate = vi.fn();
    const create = vi.fn();
    const engine: WebLlmEngine = { interruptGenerate, chat: { completions: { create } } };
    return { engine, interruptGenerate, create };
}

describe('WebLLM request coordinator', () => {
    it('removes a cancelled queued waiter without interrupting the active stream or admitting the next request early', async () => {
        const { engine, interruptGenerate, create } = createEngine();
        const firstChunk = Promise.withResolvers<IteratorResult<string>>();
        const done = Promise.withResolvers<IteratorResult<string>>();
        const iterator = {
            next: vi.fn().mockReturnValueOnce(firstChunk.promise).mockReturnValueOnce(done.promise),
        };
        const stream = { [Symbol.asyncIterator]: () => iterator };
        const active = webLlmRequestCoordinator.stream(engine, {
            create: async () => stream,
            consume: () => undefined,
        });
        const queuedAborter = new AbortController();
        const cancelled = webLlmRequestCoordinator.run(engine, {
            signal: queuedAborter.signal,
            execute: async () => 'cancelled',
        });
        const next = webLlmRequestCoordinator.run(engine, { execute: async () => 'next' });

        queuedAborter.abort(new DOMException('Cancelled', 'AbortError'));
        firstChunk.resolve({ done: false, value: 'first' });
        await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
        expect(interruptGenerate).not.toHaveBeenCalled();
        expect(create).not.toHaveBeenCalled();

        done.resolve({ done: true, value: undefined });
        await expect(active).resolves.toBeUndefined();
        await expect(next).resolves.toBe('next');
    });

    it('dispatches the first worker next before interrupting an already-aborted stream and drains without iterator return', async () => {
        const { engine, interruptGenerate } = createEngine();
        const order: string[] = [];
        interruptGenerate.mockImplementation(() => order.push('interrupt'));
        const controller = new AbortController();
        const iterator = {
            next: vi
                .fn()
                .mockImplementationOnce(async () => {
                    order.push('next');
                    return { done: false, value: 'discarded' };
                })
                .mockResolvedValueOnce({ done: true, value: undefined }),
            return: vi.fn(),
        };

        const pending = webLlmRequestCoordinator.stream(engine, {
            signal: controller.signal,
            create: async () => {
                controller.abort(new DOMException('Cancelled', 'AbortError'));
                return { [Symbol.asyncIterator]: () => iterator };
            },
            consume: () => undefined,
        });

        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        expect(order).toEqual(['next', 'interrupt']);
        expect(iterator.next).toHaveBeenCalledTimes(2);
        expect(iterator.return).not.toHaveBeenCalled();
    });

    it('drains after a consumer validation error and preserves that error', async () => {
        const { engine, interruptGenerate } = createEngine();
        const consumerError = new Error('invalid provider event');
        const iterator = {
            next: vi
                .fn()
                .mockResolvedValueOnce({ done: false, value: 'bad' })
                .mockResolvedValueOnce({ done: false, value: 'discarded' })
                .mockResolvedValueOnce({ done: true, value: undefined }),
            return: vi.fn(),
        };

        await expect(
            webLlmRequestCoordinator.stream(engine, {
                create: async () => ({ [Symbol.asyncIterator]: () => iterator }),
                consume: () => {
                    throw consumerError;
                },
            })
        ).rejects.toBe(consumerError);
        expect(interruptGenerate).toHaveBeenCalledOnce();
        expect(iterator.next).toHaveBeenCalledTimes(3);
        expect(iterator.return).not.toHaveBeenCalled();
    });

    it('rejects only the retired engine application waits and leaves a successor independent', async () => {
        const first = createEngine();
        const successor = createEngine();
        const held = Promise.withResolvers<string>();
        const active = webLlmRequestCoordinator.run(first.engine, { execute: () => held.promise });
        const queued = webLlmRequestCoordinator.run(first.engine, { execute: async () => 'queued' });
        const retired = new Error('worker failed');

        webLlmRequestCoordinator.retire(first.engine, retired);

        await expect(active).rejects.toBe(retired);
        await expect(queued).rejects.toBe(retired);
        await expect(
            webLlmRequestCoordinator.run(successor.engine, { execute: async () => 'replacement' })
        ).resolves.toBe('replacement');
        held.resolve('late');
    });
});
