import { describe, it, expect } from 'vitest';

import { runUndoRedoExclusive } from '../undoRedo';

describe('runUndoRedoExclusive', () => {
    it('should serialize overlapping mutation operations', async () => {
        const events: string[] = [];
        let releaseFirst = () => undefined;
        const firstGate = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });

        const first = runUndoRedoExclusive(async () => {
            events.push('first:start');
            await firstGate;
            events.push('first:end');
        });
        const second = runUndoRedoExclusive(async () => {
            events.push('second:start');
            events.push('second:end');
        });

        await Promise.resolve();

        expect(events).toEqual(['first:start']);

        releaseFirst();
        await Promise.all([first, second]);

        expect(events).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
    });

    it('should keep the mutation chain usable after a rejected operation', async () => {
        const failure = new Error('boom');
        const events: string[] = [];

        await expect(
            runUndoRedoExclusive(async () => {
                throw failure;
            })
        ).rejects.toBe(failure);

        await runUndoRedoExclusive(async () => {
            events.push('after-rejection');
        });

        expect(events).toEqual(['after-rejection']);
    });
});
