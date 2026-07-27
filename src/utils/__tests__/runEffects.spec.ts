import { describe, expect, it, vi } from 'vitest';

import { runAllAsyncEffects, runAllEffects } from '../runEffects';

describe('runEffects', () => {
    it('attempts every synchronous effect and aggregates failures', () => {
        const firstFailure = new Error('first');
        const secondFailure = new Error('second');
        const completed = vi.fn();

        expect(() =>
            runAllEffects([
                () => {
                    throw firstFailure;
                },
                completed,
                () => {
                    throw secondFailure;
                },
            ])
        ).toThrow(
            expect.objectContaining({
                errors: [firstFailure, secondFailure],
            })
        );
        expect(completed).toHaveBeenCalledOnce();
    });

    it('attempts every asynchronous effect and preserves a single failure', async () => {
        const failure = new Error('failed');
        const completed = vi.fn();

        await expect(
            runAllAsyncEffects([
                async () => {
                    throw failure;
                },
                completed,
            ])
        ).rejects.toBe(failure);
        expect(completed).toHaveBeenCalledOnce();
    });
});
