import { describe, it, expect, vi } from 'vitest';

import { subscribeAiChangeNotification, notifyAiChange } from '../notifyAiChange';

describe('notifyAiChange', () => {
    it('notifies subscribers when called', () => {
        let received: any = null;
        const unsubscribe = subscribeAiChangeNotification((change) => {
            received = change;
        });

        notifyAiChange('Test Summary', ['Detail 1', 'Detail 2']);

        expect(received).not.toBeNull();
        expect(received.summary).toBe('Test Summary');
        expect(received.details).toEqual(['Detail 1', 'Detail 2']);
        expect(received.id).toContain('ai-change-');
        expect(typeof received.timestamp).toBe('number');

        unsubscribe();
    });

    it('assigns a unique id to every notification, even within the same millisecond', () => {
        const ids: string[] = [];
        const unsubscribe = subscribeAiChangeNotification((change) => {
            ids.push(change.id);
        });

        // Freeze the clock so every call shares the same Date.now() value —
        // the counter, not the timestamp, must keep the ids distinct.
        const fixed = 1_700_000_000_000;
        const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(fixed);
        try {
            notifyAiChange('A', []);
            notifyAiChange('B', []);
            notifyAiChange('C', []);
        } finally {
            nowSpy.mockRestore();
        }

        expect(ids).toHaveLength(3);
        expect(new Set(ids).size).toBe(3);

        unsubscribe();
    });

    it('allows unsubscribing', () => {
        let count = 0;
        const unsubscribe = subscribeAiChangeNotification(() => {
            count++;
        });

        notifyAiChange('Test 1', []);
        expect(count).toBe(1);

        unsubscribe();

        notifyAiChange('Test 2', []);
        expect(count).toBe(1); // Should not increase
    });
});
