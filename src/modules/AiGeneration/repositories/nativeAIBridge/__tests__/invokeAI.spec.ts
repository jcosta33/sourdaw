import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { desktopInvoke } from '#/utils/desktopBridge';

import { invokeAI } from '../invokeAI';

vi.mock('#/utils/desktopBridge', () => ({
    desktopInvoke: vi.fn(),
}));

describe('invokeAI repository', () => {
    const originalBridgeDescriptor = Object.getOwnPropertyDescriptor(window, 'sourdaw');

    function restoreDesktopBridge(): void {
        if (originalBridgeDescriptor) {
            Object.defineProperty(window, 'sourdaw', originalBridgeDescriptor);
            return;
        }

        Reflect.deleteProperty(window, 'sourdaw');
    }

    beforeEach(() => {
        vi.mocked(desktopInvoke).mockReset();
    });

    afterEach(() => {
        restoreDesktopBridge();
    });

    it('should throw error if not in a desktop environment', async () => {
        Reflect.deleteProperty(window, 'sourdaw');

        await expect(invokeAI('test_cmd')).rejects.toThrow('Native AI features require');
        expect(desktopInvoke).not.toHaveBeenCalled();
    });

    it('should call the desktop bridge when the preload published window.sourdaw', async () => {
        vi.mocked(desktopInvoke).mockResolvedValue('ok');
        Object.defineProperty(window, 'sourdaw', {
            configurable: true,
            value: {},
        });

        const result = await invokeAI('test_cmd', { arg: 1 });

        expect(desktopInvoke).toHaveBeenCalledWith('test_cmd', { arg: 1 });
        expect(result).toBe('ok');
    });
});
