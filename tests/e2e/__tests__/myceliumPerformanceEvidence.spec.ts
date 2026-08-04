import { expect, it, vi } from 'vitest';

import {
    closeMeasuredBrowser,
    createMeasuredBrowserCloser,
    rejectOnPageErrorDuring,
} from '../myceliumPerformanceEvidence';

it('closes the dedicated stable Chrome browser after the context closes', async () => {
    const events: string[] = [];
    let connected = true;

    await closeMeasuredBrowser({
        browser: {
            close: () => {
                events.push('browser closed');
                connected = false;
                return Promise.resolve();
            },
            isConnected: () => connected,
        },
        timeoutMs: 1_000,
    });

    expect(events).toEqual(['browser closed']);
});

it('shares one browser shutdown across abort and final cleanup', async () => {
    const browserClose = vi.fn(() => Promise.resolve());
    const close = createMeasuredBrowserCloser({
        browser: { close: browserClose, isConnected: () => false },
        timeoutMs: 1_000,
    });

    await Promise.all([close(), close()]);
    await close();

    expect(browserClose).toHaveBeenCalledOnce();
});

it('retries a browser shutdown that failed while Chrome remained connected', async () => {
    let connected = true;
    const browserClose = vi
        .fn<() => Promise<void>>()
        .mockRejectedValueOnce(new Error('close timed out'))
        .mockImplementationOnce(() => {
            connected = false;
            return Promise.resolve();
        });
    const close = createMeasuredBrowserCloser({
        browser: { close: browserClose, isConnected: () => connected },
        timeoutMs: 1_000,
    });

    await expect(close()).rejects.toThrow('close timed out');
    await close();

    expect(browserClose).toHaveBeenCalledTimes(2);
    expect(connected).toBe(false);
});

it('accepts a timed-out close only after stable Chrome has disconnected', async () => {
    let connected = true;

    await closeMeasuredBrowser({
        browser: {
            close: () => {
                connected = false;
                return new Promise(() => undefined);
            },
            isConnected: () => connected,
        },
        timeoutMs: 1,
    });

    expect(connected).toBe(false);
});

it('aborts and drains a losing operation before surfacing a page error', async () => {
    const events: string[] = [];
    let emitPageError = (_error: Error): void => undefined;
    let finishOperation = (): void => undefined;
    const page: Parameters<typeof rejectOnPageErrorDuring>[0]['page'] = {
        on: (_event, listener) => {
            emitPageError = listener;
        },
        off: () => {
            events.push('listener removed');
        },
    };
    const operation = new Promise<void>((resolve) => {
        finishOperation = () => {
            events.push('operation settled');
            resolve();
        };
    });
    const result = rejectOnPageErrorDuring({
        abort: () => {
            events.push('abort');
            finishOperation();
            return Promise.resolve();
        },
        captureBeforeAbort: () => {
            events.push('failure evidence captured');
            return Promise.resolve();
        },
        label: 'Test operation',
        operation: () => operation,
        page,
        timeoutMs: 1_000,
    });
    emitPageError(new Error('page failed'));
    await expect(result).rejects.toThrow('page failed');
    expect(events).toEqual(['failure evidence captured', 'abort', 'operation settled', 'listener removed']);
});

it('uses a page-error monitor inherited from measured-page setup without replacing its listener', async () => {
    const events: string[] = [];
    let rejectPageError = (_error: Error): void => undefined;
    let finishOperation = (): void => undefined;
    const pageError = new Promise<never>((_resolve, reject) => {
        rejectPageError = reject;
    });
    const operation = new Promise<void>((resolve) => {
        finishOperation = resolve;
    });
    const result = rejectOnPageErrorDuring({
        abort: () => {
            events.push('abort');
            finishOperation();
            return Promise.resolve();
        },
        label: 'Inherited page-error monitor',
        operation: () => operation,
        page: {
            on: () => events.push('listener installed'),
            off: () => events.push('listener removed'),
        },
        pageError,
        timeoutMs: 1_000,
    });

    rejectPageError(new Error('setup-era renderer fault'));

    await expect(result).rejects.toThrow('setup-era renderer fault');
    expect(events).toEqual(['abort']);
});

it('removes the page-error listener and aborts when an operation throws synchronously', async () => {
    const events: string[] = [];
    const page: Parameters<typeof rejectOnPageErrorDuring>[0]['page'] = {
        on: () => {
            events.push('listener installed');
        },
        off: () => {
            events.push('listener removed');
        },
    };

    await expect(
        rejectOnPageErrorDuring({
            abort: () => {
                events.push('abort');
                return Promise.resolve();
            },
            label: 'Synchronous operation',
            operation: () => {
                throw new Error('operation failed synchronously');
            },
            page,
            timeoutMs: 1_000,
        })
    ).rejects.toThrow('operation failed synchronously');

    expect(events).toEqual(['listener installed', 'abort', 'listener removed']);
});
