import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockInvoke = vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>();

vi.mock('@tauri-apps/api/core', () => ({
    invoke: mockInvoke,
}));

import { invokeLink } from '../invokeLink';

function setTauriAvailable(): void {
    Object.defineProperty(window, '__TAURI__', {
        configurable: true,
        value: {},
    });
}

function clearTauriAvailability(): void {
    Reflect.deleteProperty(window, '__TAURI__');
}

describe('invokeLink', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearTauriAvailability();
    });

    afterEach(() => {
        clearTauriAvailability();
    });

    it('should throw when not running under Tauri', async () => {
        await expect(invokeLink('link:test')).rejects.toThrow(/Tauri desktop/);
    });

    it('should throw if not in Tauri', async () => {
        await expect(invokeLink('test')).rejects.toThrow('Ableton Link requires Tauri desktop environment');
    });

    it('should call invoke if in Tauri', async () => {
        setTauriAvailable();
        mockInvoke.mockResolvedValue('ok');
        const result = await invokeLink('test_cmd', { arg: 1 });
        expect(mockInvoke).toHaveBeenCalledWith('test_cmd', { arg: 1 });
        expect(result).toBe('ok');
    });
});
