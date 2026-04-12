import { describe, it, expect } from 'vitest';
import { onPromptInjection, injectPromptCommand } from '../promptInjection';

describe('promptInjection', () => {
    it('notifies listeners when a prompt is injected', () => {
        let receivedText = '';
        const unsubscribe = onPromptInjection((text) => {
            receivedText = text;
        });

        injectPromptCommand('Hello World');

        expect(receivedText).toBe('Hello World');

        unsubscribe();
    });

    it('allows unsubscribing', () => {
        let count = 0;
        const unsubscribe = onPromptInjection(() => {
            count++;
        });

        injectPromptCommand('Test 1');
        expect(count).toBe(1);

        unsubscribe();

        injectPromptCommand('Test 2');
        expect(count).toBe(1);
    });
});
