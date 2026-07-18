import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { invoke } from '@tauri-apps/api/core';

import { invokeAI } from '../invokeAI';

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}));

describe('invokeAI repository', () => {
    const originalTauriDescriptor = Object.getOwnPropertyDescriptor(window, '__TAURI_INTERNALS__');

    function restoreTauriMarker(): void {
        if (originalTauriDescriptor) {
            Object.defineProperty(window, '__TAURI_INTERNALS__', originalTauriDescriptor);
            return;
        }

        Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    }

    beforeEach(() => {
        vi.mocked(invoke).mockReset();
    });

    afterEach(() => {
        restoreTauriMarker();
    });

    it('should throw error if not in a Tauri desktop environment', async () => {
        Reflect.deleteProperty(window, '__TAURI_INTERNALS__');

        await expect(invokeAI('test_cmd')).rejects.toThrow('Native AI features require Tauri desktop environment');
        expect(invoke).not.toHaveBeenCalled();
    });

    it('should call tauri invoke when the Tauri v2 runtime marker is present', async () => {
        vi.mocked(invoke).mockResolvedValue('ok');
        Object.defineProperty(window, '__TAURI_INTERNALS__', {
            configurable: true,
            value: {},
        });

        const result = await invokeAI('test_cmd', { arg: 1 });

        expect(invoke).toHaveBeenCalledWith('test_cmd', { arg: 1 });
        expect(result).toBe('ok');
    });
});
