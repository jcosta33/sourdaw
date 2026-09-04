import { describe, it, expect, vi } from 'vitest';

import { HOSTED_AI_PRIVACY_DISCLOSURE_SUMMARY } from '../aiChangeNotificationState';
import { type AiChangeNotification, notifyAiChange } from '../notifyAiChange';
import { subscribeAiChangeNotification } from '../subscribeAiChangeNotification';

describe('notifyAiChange', () => {
    it('should notify current subscribers when called', () => {
        const receivedNotifications: AiChangeNotification[] = [];
        const unsubscribe = subscribeAiChangeNotification((change) => {
            receivedNotifications.push(change);
        });

        notifyAiChange('Test Summary', ['Detail 1', 'Detail 2']);

        expect(receivedNotifications).toHaveLength(1);
        const received = receivedNotifications[0];
        if (received === undefined) {
            throw new Error('Expected subscriber to receive a notification');
        }

        expect(received.summary).toBe('Test Summary');
        expect(received.details).toEqual(['Detail 1', 'Detail 2']);
        expect(received.id).toContain('ai-change-');
        expect(typeof received.timestamp).toBe('number');

        unsubscribe();
    });

    it('should notify every current subscriber', () => {
        const firstNotifications: AiChangeNotification[] = [];
        const secondNotifications: AiChangeNotification[] = [];
        const unsubscribeFirst = subscribeAiChangeNotification((change) => {
            firstNotifications.push(change);
        });
        const unsubscribeSecond = subscribeAiChangeNotification((change) => {
            secondNotifications.push(change);
        });

        notifyAiChange('Shared Summary', ['Shared Detail']);

        expect(firstNotifications.map((change) => change.summary)).toEqual(['Shared Summary']);
        expect(secondNotifications.map((change) => change.summary)).toEqual(['Shared Summary']);

        unsubscribeFirst();
        unsubscribeSecond();
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

    it('should remove only the unsubscribed listener', () => {
        const retainedNotifications: AiChangeNotification[] = [];
        const removedNotifications: AiChangeNotification[] = [];
        const unsubscribeRemoved = subscribeAiChangeNotification((change) => {
            removedNotifications.push(change);
        });
        const unsubscribeRetained = subscribeAiChangeNotification((change) => {
            retainedNotifications.push(change);
        });

        notifyAiChange('Test 1', []);
        expect(removedNotifications).toHaveLength(1);
        expect(retainedNotifications).toHaveLength(1);

        unsubscribeRemoved();

        notifyAiChange('Test 2', []);
        expect(removedNotifications.map((change) => change.summary)).toEqual(['Test 1']);
        expect(retainedNotifications.map((change) => change.summary)).toEqual(['Test 1', 'Test 2']);

        unsubscribeRetained();
    });

    it('assigns kind notice when details are empty', () => {
        const receivedNotifications: AiChangeNotification[] = [];
        const unsubscribe = subscribeAiChangeNotification((change) => {
            receivedNotifications.push(change);
        });

        notifyAiChange('Command not executed: missing target', []);

        expect(receivedNotifications).toHaveLength(1);
        expect(receivedNotifications[0]?.kind).toBe('notice');

        unsubscribe();
    });

    it('assigns kind notice for the hosted privacy disclosure summary even with details', () => {
        const receivedNotifications: AiChangeNotification[] = [];
        const unsubscribe = subscribeAiChangeNotification((change) => {
            receivedNotifications.push(change);
        });

        notifyAiChange(HOSTED_AI_PRIVACY_DISCLOSURE_SUMMARY, ['Prompt text may leave this device.']);

        expect(receivedNotifications).toHaveLength(1);
        expect(receivedNotifications[0]?.kind).toBe('notice');

        unsubscribe();
    });

    it('assigns kind applied-change for an ordinary summary with details', () => {
        const receivedNotifications: AiChangeNotification[] = [];
        const unsubscribe = subscribeAiChangeNotification((change) => {
            receivedNotifications.push(change);
        });

        notifyAiChange('Added track Drums', ['Track Drums created']);

        expect(receivedNotifications).toHaveLength(1);
        expect(receivedNotifications[0]?.kind).toBe('applied-change');

        unsubscribe();
    });
});
