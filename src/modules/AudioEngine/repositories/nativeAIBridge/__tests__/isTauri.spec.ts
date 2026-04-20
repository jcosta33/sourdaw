import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn().mockResolvedValue('ok'),
}));

import { isTauri, invokeAI } from '../isTauri';

describe('isTauri repository', () => {
    const originalWindow = global.window;

    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        global.window = originalWindow;
    });

    describe('isTauri', () => {
        it('should return true if __TAURI__ is in window', () => {
            global.window = { __TAURI__: {} } as any;
            expect(isTauri()).toBe(true);
        });

        it('should return false if __TAURI__ is not in window', () => {
            global.window = {} as any;
            expect(isTauri()).toBe(false);
        });
    });

    describe('invokeAI', () => {
        it('should throw error if not in Tauri environment', async () => {
            global.window = {} as any;
            await expect(invokeAI('test_cmd')).rejects.toThrow('Native AI features require Tauri desktop environment');
        });

        it('should call tauri invoke if in Tauri environment', async () => {
            global.window = { __TAURI__: {} } as any;

            // Mock the dynamic import of @tauri-apps/api/core
            vi.mock('@tauri-apps/api/core', () => ({
                invoke: vi.fn().mockResolvedValue('ok'),
            }));

            const result = await invokeAI('test_cmd', { arg: 1 });

            const { invoke } = await import('@tauri-apps/api/core');
            expect(invoke).toHaveBeenCalledWith('test_cmd', { arg: 1 });
            expect(result).toBe('ok');
        });
    });
});
