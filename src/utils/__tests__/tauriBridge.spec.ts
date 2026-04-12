import { describe, it, expect, vi, afterEach } from 'vitest';

const { invokeMock, listenMock, unlistenMock } = vi.hoisted(() => {
    const invokeMock = vi.fn().mockResolvedValue('invoked');
    const unlistenMock = vi.fn();
    const listenMock = vi.fn().mockResolvedValue(unlistenMock);
    return { invokeMock, listenMock, unlistenMock };
});

vi.mock('@tauri-apps/api/core', () => ({
    invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock('@tauri-apps/api/event', () => ({
    listen: (...args: unknown[]) => listenMock(...args),
}));

import { isTauri, tauriInvoke, tauriListen } from '../tauriBridge';

describe('tauriBridge', () => {
    afterEach(() => {
        delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    });

    describe('isTauri', () => {
        it('should return false when __TAURI_INTERNALS__ is absent', () => {
            expect(isTauri()).toBe(false);
        });

        it('should return true when __TAURI_INTERNALS__ is on window', () => {
            (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
            expect(isTauri()).toBe(true);
        });
    });

    it('should forward tauriInvoke to invoke', async () => {
        const result = await tauriInvoke('my_cmd', { x: 1 });
        expect(invokeMock).toHaveBeenCalledWith('my_cmd', { x: 1 });
        expect(result).toBe('invoked');
    });

    it('should forward tauriListen to listen', async () => {
        const handler = vi.fn();
        const unlisten = await tauriListen('evt', handler);
        expect(listenMock).toHaveBeenCalledWith('evt', handler);
        expect(unlisten).toBe(unlistenMock);
    });
});
