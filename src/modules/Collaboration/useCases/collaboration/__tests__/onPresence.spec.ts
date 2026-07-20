import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type PresenceDelta } from '../../../models/CollaborationTypes';
import { onPresence } from '../onPresence';

type Listener = (data: PresenceDelta) => void;

/**
 * `onPresence` only manipulates the shared listener `Set` on
 * `sessionManagement`'s `sessionRuntimePrimitives`. Mock that boundary so the
 * spec exercises subscribe/unsubscribe in isolation from the rest of the
 * session runtime.
 */
const mockRuntime = vi.hoisted(() => ({
    state: {
        presenceListeners: new Set<Listener>(),
    },
}));

vi.mock('../sessionManagement', () => ({ sessionRuntimePrimitives: mockRuntime }));

describe('onPresence', () => {
    beforeEach(() => {
        mockRuntime.state.presenceListeners.clear();
    });

    it('adds the listener to the shared presence listener set', () => {
        const listener: Listener = vi.fn();

        onPresence(listener);

        expect(mockRuntime.state.presenceListeners.has(listener)).toBe(true);
        expect(mockRuntime.state.presenceListeners.size).toBe(1);
    });

    it('returns an unsubscribe function that removes only its own listener', () => {
        const listenerA: Listener = vi.fn();
        const listenerB: Listener = vi.fn();

        const unsubscribeA = onPresence(listenerA);
        onPresence(listenerB);
        unsubscribeA();

        expect(mockRuntime.state.presenceListeners.has(listenerA)).toBe(false);
        expect(mockRuntime.state.presenceListeners.has(listenerB)).toBe(true);
    });

    it('is safe to call the unsubscribe function more than once', () => {
        const listener: Listener = vi.fn();
        const unsubscribe = onPresence(listener);

        unsubscribe();
        unsubscribe();

        expect(mockRuntime.state.presenceListeners.size).toBe(0);
    });
});
