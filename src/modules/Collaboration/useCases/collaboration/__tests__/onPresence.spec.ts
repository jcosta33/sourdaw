import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type PresenceDelta } from '../../../models/CollaborationTypes';
import { onPresence } from '../onPresence';

type Listener = (data: PresenceDelta) => void;

/**
 * `onPresence` only manipulates the app-lifetime listener `Set` on
 * `sessionManagement`'s `sessionRuntimePrimitives`. Mock that boundary so the
 * spec exercises subscribe/unsubscribe in isolation from the rest of the
 * session runtime.
 */
const mockRuntime = vi.hoisted(() => ({
    presenceListeners: new Set<Listener>(),
}));

vi.mock('../sessionManagement', () => ({ sessionRuntimePrimitives: mockRuntime }));

describe('onPresence', () => {
    beforeEach(() => {
        mockRuntime.presenceListeners.clear();
    });

    it('adds the listener to the shared presence listener set', () => {
        const listener: Listener = vi.fn();

        onPresence(listener);

        expect(mockRuntime.presenceListeners.has(listener)).toBe(true);
        expect(mockRuntime.presenceListeners.size).toBe(1);
    });

    it('returns an unsubscribe function that removes only its own listener', () => {
        const listenerA: Listener = vi.fn();
        const listenerB: Listener = vi.fn();

        const unsubscribeA = onPresence(listenerA);
        onPresence(listenerB);
        unsubscribeA();

        expect(mockRuntime.presenceListeners.has(listenerA)).toBe(false);
        expect(mockRuntime.presenceListeners.has(listenerB)).toBe(true);
    });

    it('is safe to call the unsubscribe function more than once', () => {
        const listener: Listener = vi.fn();
        const unsubscribe = onPresence(listener);

        unsubscribe();
        unsubscribe();

        expect(mockRuntime.presenceListeners.size).toBe(0);
    });
});
