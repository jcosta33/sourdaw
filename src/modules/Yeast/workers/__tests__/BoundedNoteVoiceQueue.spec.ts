import { describe, expect, it } from 'vitest';

import { BoundedNoteVoiceQueue } from '../BoundedNoteVoiceQueue';

describe('BoundedNoteVoiceQueue', () => {
    it('reports capacity exhaustion without mutating queued voices', () => {
        const queue = new BoundedNoteVoiceQueue<string>(2);

        expect(queue.tryPush('route-a', 60, 'first')).toBe(true);
        expect(queue.tryPush('route-a', 60, 'second')).toBe(true);
        expect(queue.tryPush('route-a', 60, 'rejected')).toBe(false);
        expect(queue.size).toBe(2);
        expect(queue.shift('route-a', 60)).toBe('first');
        expect(queue.shift('route-a', 60)).toBe('second');
        expect(queue.shift('route-a', 60)).toBeUndefined();
    });

    it('preserves the throwing push contract used by rack-failure fallback', () => {
        const queue = new BoundedNoteVoiceQueue<string>(1);

        queue.push(undefined, 60, 'accepted');

        expect(() => queue.push(undefined, 60, 'rejected')).toThrow('Yeast note voice capacity exceeded (1)');
        expect(queue.size).toBe(1);
        expect(queue.shift(undefined, 60)).toBe('accepted');
    });
});
