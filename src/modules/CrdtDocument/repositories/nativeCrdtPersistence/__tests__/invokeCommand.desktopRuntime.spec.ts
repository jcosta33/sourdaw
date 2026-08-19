import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockInvoke = vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>();

vi.mock('#/utils/desktopBridge', () => ({
    desktopInvoke: mockInvoke,
}));

import { invokeCommand } from '../invokeCommand';
import { isNativeCrdtAvailable } from '../isNativeCrdtAvailable';

/**
 * The native CRDT persistence bridge gates on the desktop runtime probe, which
 * answers from the preload-published `window.sourdaw`. A bridge probing
 * anything else is latently always-false on desktop, so `invokeCommand`
 * silently returns null and `isNativeCrdtAvailable` reports false even in the
 * packaged desktop app.
 */
describe('nativeCrdtPersistence on the desktop runtime', () => {
    const originalBridge = Object.getOwnPropertyDescriptor(window, 'sourdaw');

    function restoreBridge(): void {
        if (originalBridge) {
            Object.defineProperty(window, 'sourdaw', originalBridge);
        } else {
            Reflect.deleteProperty(window, 'sourdaw');
        }
    }

    beforeEach(() => {
        vi.clearAllMocks();
        // Simulate the Electron shell: the preload published its bridge.
        Object.defineProperty(window, 'sourdaw', {
            configurable: true,
            value: {},
        });
    });

    afterEach(() => {
        restoreBridge();
    });

    it('reports the native backend available when the desktop bridge is present', () => {
        expect(isNativeCrdtAvailable()).toBe(true);
    });

    it('invokes the native command when the desktop bridge is present', async () => {
        mockInvoke.mockResolvedValue('native-ok');

        const result = await invokeCommand('crdt_apply_change', { docId: 'd1' });

        expect(mockInvoke).toHaveBeenCalledWith('crdt_apply_change', { docId: 'd1' });
        expect(result).toBe('native-ok');
    });
});

describe('nativeCrdtPersistence on the browser runtime', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // The desktop bridge is not present in a plain browser tab.
        Reflect.deleteProperty(window, 'sourdaw');
    });

    it('returns null without invoking any native command when off desktop', async () => {
        const result = await invokeCommand('crdt_apply_change', { docId: 'd1' });

        // The native bridge must be a no-op outside the desktop shell so the
        // app falls back to the IndexedDB persistence path silently.
        expect(result).toBeNull();
        expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('isNativeCrdtAvailable reports unavailable when the desktop bridge is absent', async () => {
        vi.resetModules();
        // Re-import to re-evaluate the live (bridge-less) window.
        const { isNativeCrdtAvailable } = await import('../isNativeCrdtAvailable');
        expect(isNativeCrdtAvailable()).toBe(false);
    });
});
