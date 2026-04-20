import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
    invoke: mockInvoke,
}));

import { disableLink } from '../disableLink';
import { enableLink } from '../enableLink';
import { getLinkStatus } from '../getLinkStatus';
import { invokeLink, isTauri } from '../helpers';

describe('linkBridge repository', () => {
    const originalWindow = global.window;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        global.window = originalWindow;
    });

    describe('invokeLink', () => {
        it('should throw if not in Tauri', async () => {
            global.window = {} as any;
            await expect(invokeLink('test')).rejects.toThrow('Ableton Link requires Tauri desktop environment');
        });

        it('should call invoke if in Tauri', async () => {
            global.window = { __TAURI__: {} } as any;
            mockInvoke.mockResolvedValue('ok');
            const result = await invokeLink('test_cmd', { arg: 1 });
            expect(mockInvoke).toHaveBeenCalledWith('test_cmd', { arg: 1 });
            expect(result).toBe('ok');
        });
    });

    describe('getLinkStatus', () => {
        it('should return status from Tauri', async () => {
            global.window = { __TAURI__: {} } as any;
            const mockStatus = { enabled: true, tempo: 120 };
            mockInvoke.mockResolvedValue(mockStatus);

            const status = await getLinkStatus();
            expect(status).toEqual(mockStatus);
        });
    });

    describe('enableLink / disableLink', () => {
        it('should call tauri commands', async () => {
            global.window = { __TAURI__: {} } as any;

            await enableLink();
            expect(mockInvoke).toHaveBeenCalledWith('enable_link', undefined);

            await disableLink();
            expect(mockInvoke).toHaveBeenCalledWith('disable_link', undefined);
        });
    });
});
