import { describe, it, expect, vi, afterEach } from 'vitest';

import { registerGlobalErrorHandlers } from '../registerGlobalErrorHandlers';

import type { Logger } from '#/infra/logger/types';

function createLoggerStub(): Logger {
    return {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        setWriters: vi.fn(),
    };
}

function dispatchUnhandledRejection(reason: unknown): void {
    // jsdom does not construct PromiseRejectionEvent, so synthesize an event of
    // the same type carrying a `reason`, matching what the handler reads.
    const event = new Event('unhandledrejection') as Event & { reason: unknown };
    event.reason = reason;
    window.dispatchEvent(event);
}

describe('registerGlobalErrorHandlers', () => {
    let dispose: (() => void) | undefined;

    afterEach(() => {
        dispose?.();
        dispose = undefined;
    });

    it('logs an unhandled rejection with the reason as the error cause', () => {
        const logger = createLoggerStub();
        dispose = registerGlobalErrorHandlers({ logger });

        const reason = new Error('boom');
        dispatchUnhandledRejection(reason);

        expect(logger.error).toHaveBeenCalledTimes(1);
        const logged = vi.mocked(logger.error).mock.calls[0]![0];
        expect(logged).toBeInstanceOf(Error);
        expect(logged.message).toBe('Unhandled promise rejection');
        expect(logged.cause).toBe(reason);
    });

    it('stops logging once the disposer removes the listener', () => {
        const logger = createLoggerStub();
        const disposeLocal = registerGlobalErrorHandlers({ logger });
        disposeLocal();

        dispatchUnhandledRejection(new Error('after dispose'));

        expect(logger.error).not.toHaveBeenCalled();
    });
});
