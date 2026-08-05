import { describe, expect, it, vi } from 'vitest';

import { createSubscriptionRegistry } from '../createSubscriptionRegistry';

type TestEvents = {
    open: { url: string };
    close: { reason: string };
};

describe('createSubscriptionRegistry — on/off', () => {
    it('registers a handler and includes it in the snapshot', () => {
        const registry = createSubscriptionRegistry<TestEvents>();
        const handler = vi.fn();
        registry.on('open', handler);
        const snapshot = registry.getSnapshot('open');
        expect(snapshot.eventHandlers).toContain(handler);
    });

    it('returns an unsubscribe function that removes the handler', () => {
        const registry = createSubscriptionRegistry<TestEvents>();
        const handler = vi.fn();
        const unsubscribe = registry.on('open', handler);
        unsubscribe();
        const snapshot = registry.getSnapshot('open');
        expect(snapshot.eventHandlers).not.toContain(handler);
    });

    it('off is a no-op when the event has no subscribers', () => {
        const registry = createSubscriptionRegistry<TestEvents>();
        const handler = vi.fn();
        // Should not throw
        registry.on('open', handler);
        registry.on('open', handler);
        // Deleting twice is safe
        const unsub = registry.on('close', handler);
        unsub();
        unsub(); // second call is a no-op
    });
});

describe('createSubscriptionRegistry — once', () => {
    it('auto-removes the handler after the first invocation', () => {
        const registry = createSubscriptionRegistry<TestEvents>();
        const handler = vi.fn();
        registry.once('open', handler);

        const snapshot1 = registry.getSnapshot('open');
        expect(snapshot1.eventHandlers).toHaveLength(1);

        // Simulate dispatch
        const wrapped = snapshot1.eventHandlers[0]!;
        void wrapped({ url: 'http://example.com' });
        expect(handler).toHaveBeenCalledWith({ url: 'http://example.com' });

        // After invocation, handler is removed
        const snapshot2 = registry.getSnapshot('open');
        expect(snapshot2.eventHandlers).not.toContain(wrapped);
    });

    it('returns an unsubscribe function that cancels before first invocation', () => {
        const registry = createSubscriptionRegistry<TestEvents>();
        const handler = vi.fn();
        const unsubscribe = registry.once('open', handler);
        unsubscribe();
        const snapshot = registry.getSnapshot('open');
        expect(snapshot.eventHandlers).toHaveLength(0);
    });
});

describe('createSubscriptionRegistry — onAny', () => {
    it('registers a wildcard handler included in every snapshot', () => {
        const registry = createSubscriptionRegistry<TestEvents>();
        const wildcard = vi.fn();
        registry.onAny(wildcard);
        const snapshot = registry.getSnapshot('open');
        expect(snapshot.anyHandlers).toContain(wildcard);
        const snapshot2 = registry.getSnapshot('close');
        expect(snapshot2.anyHandlers).toContain(wildcard);
    });

    it('returns an unsubscribe function that removes the wildcard handler', () => {
        const registry = createSubscriptionRegistry<TestEvents>();
        const wildcard = vi.fn();
        const unsubscribe = registry.onAny(wildcard);
        unsubscribe();
        const snapshot = registry.getSnapshot('open');
        expect(snapshot.anyHandlers).not.toContain(wildcard);
    });
});

describe('createSubscriptionRegistry — getSnapshot', () => {
    it('returns independent arrays (snapshots are copies, not live references)', () => {
        const registry = createSubscriptionRegistry<TestEvents>();
        const handler = vi.fn();
        registry.on('open', handler);
        const snap1 = registry.getSnapshot('open');
        // Mutate the returned array — should not affect the registry
        snap1.eventHandlers.length = 0;
        const snap2 = registry.getSnapshot('open');
        expect(snap2.eventHandlers).toContain(handler);
    });

    it('returns empty arrays for events with no subscribers', () => {
        const registry = createSubscriptionRegistry<TestEvents>();
        const snapshot = registry.getSnapshot('open');
        expect(snapshot.eventHandlers).toEqual([]);
        expect(snapshot.anyHandlers).toEqual([]);
    });
});
