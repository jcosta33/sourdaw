import { describe, expect, it, vi } from 'vitest';

import {
    completeMacCloseAfterSessionQuiesce,
    createRendererSessionQuiescer,
    RENDERER_SESSION_QUIESCE_TIMEOUT_MS,
} from '../rendererSessionQuiescer.js';

describe('renderer session quiescer', () => {
    it('waits for the exact renderer acknowledgement and bounds a missing acknowledgement', async () => {
        let timeout: (() => void) | undefined;
        const window = { isDestroyed: () => false, webContents: { send: vi.fn() } };
        const quiescer = createRendererSessionQuiescer('renderer:quiesce', {
            setTimer: (callback) => {
                timeout = callback;
                return { cancel: vi.fn() };
            },
        });

        const first = quiescer.request(window);
        expect(window.webContents.send).toHaveBeenCalledWith('renderer:quiesce', 1);
        quiescer.resolve(window, 2, true);
        quiescer.resolve(window, 1, true);
        await expect(first).resolves.toBe(true);

        const second = quiescer.request(window);
        timeout?.();
        await expect(second).resolves.toBe(false);
        expect(RENDERER_SESSION_QUIESCE_TIMEOUT_MS).toBe(5_000);
    });

    it('does not let native editor detach/window close begin before renderer project runtime quiesces', async () => {
        let release!: (quiesced: boolean) => void;
        const order: string[] = [];
        const close = completeMacCloseAfterSessionQuiesce({
            request: () =>
                new Promise<boolean>((resolve) => {
                    release = resolve;
                }),
            shouldProceed: () => true,
            close: () => order.push('editor-detach-and-window-close'),
            cancel: () => order.push('cancel'),
        });

        expect(order).toEqual([]);
        release(true);
        await close;
        expect(order).toEqual(['editor-detach-and-window-close']);
    });

    it('cancels before any destructive request when close authority is revoked, and tolerates a late timeout completion', async () => {
        const order: string[] = [];
        await completeMacCloseAfterSessionQuiesce({
            request: async () => {
                order.push('request');
                return true;
            },
            shouldProceed: () => false,
            close: () => order.push('close'),
            cancel: () => order.push('cancel'),
        });

        expect(order).toEqual(['cancel']);
    });
});
