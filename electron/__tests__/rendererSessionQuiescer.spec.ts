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
        quiescer.resolve(window, { requestId: 2, outcome: 'success' });
        quiescer.resolve(window, { requestId: 1, outcome: 'success' });
        await expect(first).resolves.toBe('success');
        await expect(quiescer.request(window)).resolves.toBe('success');

        const secondWindow = { isDestroyed: () => false, webContents: { send: vi.fn() } };
        const second = quiescer.request(secondWindow);
        timeout?.();
        await expect(second).resolves.toBe('rejected');
        expect(RENDERER_SESSION_QUIESCE_TIMEOUT_MS).toBe(5_000);
    });

    it('requires a final renderer acknowledgement after teardown starts, and rejects a revoked pre-start request', async () => {
        let timeout: (() => void) | undefined;
        const window = { isDestroyed: () => false, webContents: { send: vi.fn() } };
        const quiescer = createRendererSessionQuiescer('renderer:quiesce', {
            setTimer: (callback) => {
                timeout = callback;
                return { cancel: vi.fn() };
            },
        });

        const started = quiescer.request(window);
        expect(quiescer.start(window, 1)).toBe(true);
        quiescer.cancel(); // A revision revoke cannot manufacture success.
        timeout?.();
        await expect(started).resolves.toBe('rejected');
        quiescer.resolve(window, { requestId: 1, outcome: 'success' }); // late completion is harmless

        const revoked = quiescer.request(window);
        quiescer.cancel();
        await expect(revoked).resolves.toBe('rejected');
        expect(quiescer.start(window, 2)).toBe(false);
    });

    it('asks a started renderer to restore its session before denying a revoked or timed-out close', async () => {
        let timeout: (() => void) | undefined;
        const window = { isDestroyed: () => false, webContents: { send: vi.fn() } };
        const quiescer = createRendererSessionQuiescer('renderer:quiesce', 'renderer:cancel', {
            setTimer: (callback) => {
                timeout = callback;
                return { cancel: vi.fn() };
            },
        });

        const revoked = quiescer.request(window);
        expect(quiescer.start(window, 1)).toBe(true);
        quiescer.cancel();
        expect(window.webContents.send).toHaveBeenLastCalledWith('renderer:cancel', 1);
        timeout?.();
        await expect(revoked).resolves.toBe('rejected');
    });

    it('holds later requests until a queued successful teardown acknowledges correlated cancellation', async () => {
        const window = { isDestroyed: () => false, webContents: { send: vi.fn() } };
        const quiescer = createRendererSessionQuiescer('renderer:quiesce', 'renderer:cancel');

        const completed = quiescer.request(window);
        expect(quiescer.start(window, 1)).toBe(true);
        quiescer.resolve(window, { requestId: 1, outcome: 'success' }); // Final success is queued before authority revokes.
        await expect(completed).resolves.toBe('success');

        quiescer.cancel();
        expect(window.webContents.send).toHaveBeenLastCalledWith('renderer:cancel', 1);
        await expect(quiescer.request(window)).resolves.toBe('rejected');

        quiescer.resolve(window, { requestId: 1, outcome: 'rejected' }); // Renderer repaired the exact cancelled request.
        const retry = quiescer.request(window);
        expect(window.webContents.send).toHaveBeenLastCalledWith('renderer:quiesce', 2);
        quiescer.resolve(window, { requestId: 2, outcome: 'rejected' });
        await expect(retry).resolves.toBe('rejected');
    });

    it('settles a destroyed window request without recovery and immediately admits its replacement', async () => {
        const destroyed = { value: false };
        const window = { isDestroyed: () => destroyed.value, webContents: { send: vi.fn() } };
        const replacement = { isDestroyed: () => false, webContents: { send: vi.fn() } };
        const quiescer = createRendererSessionQuiescer('renderer:quiesce', 'renderer:cancel');

        const pending = quiescer.request(window);
        expect(quiescer.start(window, 1)).toBe(true);
        destroyed.value = true;
        quiescer.finalize(window);

        await expect(pending).resolves.toBe('rejected');
        expect(window.webContents.send).not.toHaveBeenCalledWith('renderer:cancel', 1);

        const next = quiescer.request(replacement);
        expect(replacement.webContents.send).toHaveBeenCalledWith('renderer:quiesce', 2);
        quiescer.resolve(replacement, { requestId: 2, outcome: 'rejected' });
        await expect(next).resolves.toBe('rejected');
    });

    it('does not let native editor detach/window close begin before renderer project runtime quiesces', async () => {
        let release!: (outcome: 'success') => void;
        const order: string[] = [];
        const close = completeMacCloseAfterSessionQuiesce({
            request: () =>
                new Promise<'success'>((resolve) => {
                    release = resolve;
                }),
            shouldProceed: () => true,
            close: () => order.push('editor-detach-and-window-close'),
            cancel: () => order.push('cancel'),
        });

        expect(order).toEqual([]);
        release('success');
        await close;
        expect(order).toEqual(['editor-detach-and-window-close']);
    });

    it('cancels before any destructive request when close authority is revoked, and tolerates a late timeout completion', async () => {
        const order: string[] = [];
        await completeMacCloseAfterSessionQuiesce({
            request: async () => {
                order.push('request');
                return 'success' as const;
            },
            shouldProceed: () => false,
            close: () => order.push('close'),
            cancel: () => order.push('cancel'),
        });

        expect(order).toEqual(['cancel']);
    });

    it('never treats a terminal renderer result as truthy Close approval', async () => {
        const close = vi.fn();
        const cancel = vi.fn();

        await completeMacCloseAfterSessionQuiesce({
            request: async () => 'terminal',
            shouldProceed: () => true,
            close,
            cancel,
        });

        expect(close).not.toHaveBeenCalled();
        expect(cancel).toHaveBeenCalledOnce();
    });

    it('requires exact correlation before accepting a terminal renderer result', async () => {
        const window = { isDestroyed: () => false, webContents: { send: vi.fn() } };
        const quiescer = createRendererSessionQuiescer('renderer:quiesce', 'renderer:cancel');
        const result = quiescer.request(window);

        expect(quiescer.start(window, 1)).toBe(true);
        quiescer.resolve(window, { requestId: 2, outcome: 'terminal' });
        await Promise.resolve();
        expect(window.webContents.send).toHaveBeenCalledOnce();

        quiescer.resolve(window, { requestId: 1, outcome: 'terminal' });
        await expect(result).resolves.toBe('terminal');
        await expect(quiescer.request(window)).resolves.toBe('terminal');
    });

    it('cancels Close when renderer quiescence is reversibly rejected', async () => {
        const close = vi.fn();
        const cancel = vi.fn();

        await completeMacCloseAfterSessionQuiesce({
            request: async () => 'rejected',
            shouldProceed: () => true,
            close,
            cancel,
        });

        expect(close).not.toHaveBeenCalled();
        expect(cancel).toHaveBeenCalledOnce();
    });
});
