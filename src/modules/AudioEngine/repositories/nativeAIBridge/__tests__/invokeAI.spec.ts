import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { invoke } from '@tauri-apps/api/core';

import { invokeAI } from '../invokeAI';

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}));

describe('invokeAI repository', () => {
    const originalTauriDescriptor = Object.getOwnPropertyDescriptor(window, '__TAURI__');

    function restoreTauriMarker(): void {
        if (originalTauriDescriptor) {
            Object.defineProperty(window, '__TAURI__', originalTauriDescriptor);
            return;
        }

        Reflect.deleteProperty(window, '__TAURI__');
    }

    beforeEach(() => {
        vi.mocked(invoke).mockReset();
    });

    afterEach(() => {
        restoreTauriMarker();
    });

    it('should throw error if not in Tauri environment', async () => {
        Reflect.deleteProperty(window, '__TAURI__');

        await expect(invokeAI('test_cmd')).rejects.toThrow('Native AI features require Tauri desktop environment');
        expect(invoke).not.toHaveBeenCalled();
    });

    it('should call tauri invoke if in Tauri environment', async () => {
        vi.mocked(invoke).mockResolvedValue('ok');
        Object.defineProperty(window, '__TAURI__', {
            configurable: true,
            value: {},
        });

        const result = await invokeAI('test_cmd', { arg: 1 });

        expect(invoke).toHaveBeenCalledWith('test_cmd', { arg: 1 });
        expect(result).toBe('ok');
    });
});
