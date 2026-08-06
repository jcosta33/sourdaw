import { describe, expect, it } from 'vitest';

import { linkCloudRequestAbort } from '../linkCloudRequestAbort';

describe('linkCloudRequestAbort', () => {
    it('returns a no-op when no caller signal is provided', () => {
        const controller = new AbortController();
        const unlink = linkCloudRequestAbort(undefined, controller);
        expect(typeof unlink).toBe('function');
        expect(() => unlink()).not.toThrow();
        expect(controller.signal.aborted).toBe(false);
    });

    it('aborts the request immediately when the caller signal is already aborted', () => {
        const callerController = new AbortController();
        const reason = new Error('Pre-cancelled');
        callerController.abort(reason);
        const requestController = new AbortController();
        const unlink = linkCloudRequestAbort(callerController.signal, requestController);
        expect(requestController.signal.aborted).toBe(true);
        expect(requestController.signal.reason).toBe(reason);
        // The returned unlink is a no-op (listener was never attached)
        expect(() => unlink()).not.toThrow();
    });

    it('aborts the request when the caller signal fires after linking', () => {
        const callerController = new AbortController();
        const requestController = new AbortController();
        const unlink = linkCloudRequestAbort(callerController.signal, requestController);
        expect(requestController.signal.aborted).toBe(false);
        callerController.abort();
        expect(requestController.signal.aborted).toBe(true);
        // Unlink should be safe to call after abort
        expect(() => unlink()).not.toThrow();
    });

    it('does NOT abort the request when the caller signal never fires', () => {
        const callerController = new AbortController();
        const requestController = new AbortController();
        linkCloudRequestAbort(callerController.signal, requestController);
        expect(requestController.signal.aborted).toBe(false);
    });

    it('cleans up the listener when unlink is called before abort', () => {
        const callerController = new AbortController();
        const requestController = new AbortController();
        const unlink = linkCloudRequestAbort(callerController.signal, requestController);
        unlink();
        // After unlink, aborting the caller should NOT abort the request
        callerController.abort();
        expect(requestController.signal.aborted).toBe(false);
    });
});
