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

    it('visits every queued voice across routes and keys, FIFO within a key', () => {
        const queue = new BoundedNoteVoiceQueue<string>(16);
        queue.push('route-a', 60, 'a-60-1');
        queue.push('route-a', 60, 'a-60-2');
        queue.push('route-a', 67, 'a-67');
        queue.push('route-b', 60, 'b-60');

        const visited: Array<{ value: string; route: string | undefined; key: string | number }> = [];
        queue.visit((value, routeId, key) => visited.push({ value, route: routeId, key }));

        expect(visited.map((entry) => entry.value)).toEqual(['a-60-1', 'a-60-2', 'a-67', 'b-60']);
        // The visitor receives the route and key each voice belongs to.
        expect(visited[0]).toEqual({ value: 'a-60-1', route: 'route-a', key: 60 });
        expect(visited[3]).toEqual({ value: 'b-60', route: 'route-b', key: 60 });
    });

    it('frees the route map entry once its last key is shifted out', () => {
        const queue = new BoundedNoteVoiceQueue<string>(16);
        queue.push('route-a', 60, 'a-60');
        queue.push('route-a', 67, 'a-67');

        // Shifting one key leaves the route alive (it still holds key 67).
        expect(queue.shift('route-a', 60)).toBe('a-60');
        expect(queue.size).toBe(1);
        // Shifting the last key empties the route; the route map entry is removed
        // so a subsequent shift returns undefined (no stale empty route).
        expect(queue.shift('route-a', 67)).toBe('a-67');
        expect(queue.size).toBe(0);
        expect(queue.shift('route-a', 60)).toBeUndefined();
        // After full drainage the queue still accepts new pushes on that route.
        expect(queue.tryPush('route-a', 60, 'reopened')).toBe(true);
        expect(queue.shift('route-a', 60)).toBe('reopened');
    });

    it('clear removes every voice across all routes and resets the count', () => {
        const queue = new BoundedNoteVoiceQueue<string>(16);
        queue.push('route-a', 60, 'a-60');
        queue.push('route-b', 67, 'b-67');
        expect(queue.size).toBe(2);

        queue.clear();

        expect(queue.size).toBe(0);
        const visited: string[] = [];
        queue.visit((value) => visited.push(value));
        expect(visited).toEqual([]);
    });
});
