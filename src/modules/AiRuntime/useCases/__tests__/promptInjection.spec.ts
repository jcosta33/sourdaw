import { describe, it, expect } from 'vitest';

import { onPromptInjection } from '../onPromptInjection';
import { injectPromptCommand } from '../promptInjection';

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

    it('notifies multiple listeners synchronously', () => {
        const receivedText: string[] = [];
        const unsubscribeFirst = onPromptInjection((text) => {
            receivedText.push(`first:${text}`);
        });
        const unsubscribeSecond = onPromptInjection((text) => {
            receivedText.push(`second:${text}`);
        });

        injectPromptCommand('Sync Text');
        receivedText.push('after-inject');

        expect(receivedText).toEqual(['first:Sync Text', 'second:Sync Text', 'after-inject']);

        unsubscribeFirst();
        unsubscribeSecond();
    });

    it('removes only the unsubscribed listener', () => {
        const firstListenerText: string[] = [];
        const secondListenerText: string[] = [];
        const unsubscribeFirst = onPromptInjection((text) => {
            firstListenerText.push(text);
        });
        const unsubscribeSecond = onPromptInjection((text) => {
            secondListenerText.push(text);
        });

        unsubscribeFirst();

        injectPromptCommand('Kept Listener');

        expect(firstListenerText).toEqual([]);
        expect(secondListenerText).toEqual(['Kept Listener']);

        unsubscribeSecond();
    });
});
