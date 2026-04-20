import { describe, it, expect } from 'vitest';

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
