import { afterEach, describe, expect, it } from 'vitest';

import { injectPromptDraft } from '../injectPromptDraft';
import { onPromptDraft } from '../onPromptDraft';

const subscriptions: Array<() => void> = [];

afterEach(() => {
    for (const unsubscribe of subscriptions.splice(0)) {
        unsubscribe();
    }
});

describe('prompt draft fan-out', () => {
    it('notifies every real draft subscriber synchronously', () => {
        const receivedText: string[] = [];
        subscriptions.push(
            onPromptDraft((text) => receivedText.push(`first:${text}`)),
            onPromptDraft((text) => receivedText.push(`second:${text}`))
        );

        injectPromptDraft('Auto-organize the tracks');
        receivedText.push('after-inject');

        expect(receivedText).toEqual([
            'first:Auto-organize the tracks',
            'second:Auto-organize the tracks',
            'after-inject',
        ]);
    });

    it('removes only the unsubscribed listener', () => {
        const first: string[] = [];
        const second: string[] = [];
        const unsubscribeFirst = onPromptDraft((text) => first.push(text));
        const unsubscribeSecond = onPromptDraft((text) => second.push(text));
        subscriptions.push(unsubscribeSecond);

        unsubscribeFirst();
        injectPromptDraft('Keep the active listener');

        expect(first).toEqual([]);
        expect(second).toEqual(['Keep the active listener']);
    });
});
