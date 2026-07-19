import { describe, expect, it } from 'vitest';

import { withGrinderNeuralLibraryWriteLock } from '../withGrinderNeuralLibraryWriteLock';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
    let resolve_fn!: (value: T) => void;
    let reject_fn!: (error: unknown) => void;
    const promise = new Promise<T>((resolve, reject) => {
        resolve_fn = resolve;
        reject_fn = reject;
    });
    return { promise, resolve: resolve_fn, reject: reject_fn };
}

describe('withGrinderNeuralLibraryWriteLock', () => {
    it('should run a single operation and resolve with its result', async () => {
        const result = await withGrinderNeuralLibraryWriteLock(async () => 'done');

        expect(result).toBe('done');
    });

    it('should serialize a second operation behind the first instead of running them concurrently', async () => {
        const order: string[] = [];
        const first = deferred<void>();

        const first_call = withGrinderNeuralLibraryWriteLock(async () => {
            order.push('first-start');
            await first.promise;
            order.push('first-end');
        });

        const second_call = withGrinderNeuralLibraryWriteLock(async () => {
            order.push('second-start');
        });

        // The second operation must not have started while the first is still pending,
        // even though both were scheduled before either settled.
        await Promise.resolve();
        await Promise.resolve();
        expect(order).toEqual(['first-start']);

        first.resolve();
        await first_call;
        await second_call;

        expect(order).toEqual(['first-start', 'first-end', 'second-start']);
    });

    it('should still run a later operation after an earlier one rejects', async () => {
        const order: string[] = [];

        const failing_call = withGrinderNeuralLibraryWriteLock(async () => {
            order.push('failing');
            throw new Error('write failed');
        });

        const next_call = withGrinderNeuralLibraryWriteLock(async () => {
            order.push('recovered');
            return 'ok';
        });

        await expect(failing_call).rejects.toThrow('write failed');
        await expect(next_call).resolves.toBe('ok');
        expect(order).toEqual(['failing', 'recovered']);
    });

    it('should reject only the caller whose own operation failed, leaving others queued normally', async () => {
        const results: string[] = [];

        const call_a = withGrinderNeuralLibraryWriteLock(async () => {
            results.push('a');
            return 'a-result';
        });
        const call_b = withGrinderNeuralLibraryWriteLock(async () => {
            results.push('b');
            throw new Error('b failed');
        });
        const call_c = withGrinderNeuralLibraryWriteLock(async () => {
            results.push('c');
            return 'c-result';
        });

        await expect(call_a).resolves.toBe('a-result');
        await expect(call_b).rejects.toThrow('b failed');
        await expect(call_c).resolves.toBe('c-result');
        expect(results).toEqual(['a', 'b', 'c']);
    });
});
